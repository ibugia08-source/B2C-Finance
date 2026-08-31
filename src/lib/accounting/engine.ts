import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { toCompetence, isCompetence, type Competence } from "@/lib/competence";
import {
  getPostingRule,
  POSTING_RULES_VERSION,
  LEDGER_FLAG,
  type PostingEventType,
} from "./posting-rules";

/**
 * ACCOUNTING ENGINE (01 §3.10-3.11; 03 §4.1).
 *
 * Único caminho para o razão. O domínio publica um FATO; o motor busca a
 * PostingRule ativa, resolve as contas e grava a partida dobrada.
 *
 * O que o motor garante, e por isso nenhuma tela pode escrever ledger:
 *  - débitos = créditos em toda transação (recusa antes de gravar);
 *  - um lançamento tem um lado só;
 *  - o mesmo fato não posta duas vezes (idempotencyKey única no banco);
 *  - a versão da regra usada fica gravada — mudar a matriz não reescreve o
 *    passado (01 §2.21-2.22).
 *
 * Correção é por REVERSAL: transação postada nunca é editada nem apagada.
 *
 * Nesta fase a postagem está atrás da bandeira `ledger_enabled`, DESLIGADA
 * por padrão (F0.8): o motor calcula e valida, mas só grava quando o
 * administrador liga.
 */

export type PostingContext = {
  workspaceId: string;
  ownerId?: string | null;
  /** Sobrescreve a conta de débito da regra (ex.: a receita da modalidade). */
  debitAccountCode?: string;
  /** Sobrescreve a conta de crédito da regra (ex.: o banco usado). */
  creditAccountCode?: string;
  agencyId?: string | null;
  clientId?: string | null;
  serviceId?: string | null;
};

export type PostingFact = {
  eventType: PostingEventType;
  /** Entidade de origem: "Billing", "Payment", "Transaction"... */
  sourceType: string;
  sourceId: string;
  /** Competência do resultado (YYYY-MM). */
  competence: Competence;
  /** Valor SEMPRE positivo; o lado é decidido pela regra. */
  amount: number | Prisma.Decimal;
  /** Data do fato no razão (padrão: agora). */
  postedAt?: Date;
  context: PostingContext;
};

export type PostingResult =
  | { ok: true; posted: true; ledgerTransactionId: string }
  | { ok: true; posted: false; reason: "flag_desligada" | "ja_postado"; ledgerTransactionId?: string }
  | { ok: false; error: string };

/** Erro de regra contábil — vira `{ ok:false }`, nunca 500. */
class PostingError extends Error {}

/** A bandeira que libera a gravação no razão está ligada? */
export async function isLedgerEnabled(workspaceId: string): Promise<boolean> {
  const flag = await runWithoutScope(async () =>
    prisma.featureFlag.findFirst({
      where: { workspaceId, key: LEDGER_FLAG },
      select: { enabled: true },
    })
  );
  return flag?.enabled === true;
}

/**
 * Chave de idempotência do fato: mesmo evento, mesma origem e mesma
 * competência postam UMA vez só. A unicidade é garantida no banco
 * (@@unique workspaceId+idempotencyKey), não só aqui (01 §2.13).
 */
export function idempotencyKeyOf(fact: Pick<PostingFact, "eventType" | "sourceType" | "sourceId" | "competence">): string {
  return `${fact.eventType}:${fact.sourceType}:${fact.sourceId}:${fact.competence}`;
}

/**
 * Posta um fato no razão. Devolve `posted:false` (sem erro) quando a bandeira
 * está desligada ou o fato já foi postado — as duas situações são normais.
 */
/**
 * Cliente de transação — o que $transaction entrega ao callback.
 * O motor aceita um para poder postar DENTRO da transação do fato, como o
 * pipeline de 03 §4.1 exige ("... -> AccountingEngine -> AuditLog ->
 * OutboxEvent -> commit"). Postar depois do commit deixaria uma janela em
 * que o dinheiro existe e o lançamento não.
 */
type TxClient = {
  ledgerTransaction: { create: (a: any) => Promise<any>; findFirst: (a: any) => Promise<any> };
  ledgerEntry: { createMany: (a: any) => Promise<any> };
};

export async function post(fact: PostingFact, tx?: TxClient): Promise<PostingResult> {
  try {
    const { context } = fact;
    const valor = new Prisma.Decimal(fact.amount as any);

    if (!isCompetence(fact.competence))
      throw new PostingError(`Competência inválida: "${fact.competence}" (esperado YYYY-MM).`);
    if (valor.lessThanOrEqualTo(0))
      throw new PostingError("Valor do lançamento deve ser positivo — o lado é decidido pela regra.");

    const regra = getPostingRule(fact.eventType);
    if (!regra.implemented)
      throw new PostingError(
        `Evento "${fact.eventType}" está na matriz mas ainda não é postado pelo motor (Fase 3).`
      );

    const chave = idempotencyKeyOf(fact);

    // Já postado? Não é erro: é a idempotência funcionando.
    const existente = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({
        where: { workspaceId: context.workspaceId, idempotencyKey: chave },
        select: { id: true },
      })
    );
    if (existente)
      return { ok: true, posted: false, reason: "ja_postado", ledgerTransactionId: existente.id };

    // Contas: a regra dá o padrão, o contexto refina.
    const codigoDebito = context.debitAccountCode ?? regra.debitAccountCode;
    const codigoCredito = context.creditAccountCode ?? regra.creditAccountCode;
    const [contaDebito, contaCredito] = await Promise.all([
      buscarConta(context.workspaceId, codigoDebito),
      buscarConta(context.workspaceId, codigoCredito),
    ]);

    // A natureza é conferida ANTES da bandeira, de propósito: com o razão
    // desligado o motor continua VALIDANDO, e é assim que uma regra errada
    // aparece em desenvolvimento em vez de aparecer em produção no primeiro
    // fechamento (F0.8).
    conferirNatureza(fact.eventType, regra.affectsPnl, contaDebito, contaCredito);

    if (!await isLedgerEnabled(context.workspaceId))
      return { ok: true, posted: false, reason: "flag_desligada" };

    // Com `tx`, escreve na transação de quem chamou; sem, abre a própria.
    const escrever = async (db: TxClient) => {
        const transacao = await db.ledgerTransaction.create({
          data: {
            workspaceId: context.workspaceId,
            eventType: fact.eventType,
            sourceType: fact.sourceType,
            sourceId: fact.sourceId,
            competence: fact.competence,
            postedAt: fact.postedAt ?? new Date(),
            postingRuleVersion: POSTING_RULES_VERSION,
            idempotencyKey: chave,
            ownerId: context.ownerId ?? null,
          },
          select: { id: true },
        });
        await db.ledgerEntry.createMany({
          data: [
            {
              ledgerTransactionId: transacao.id,
              accountId: contaDebito.id,
              debit: valor,
              credit: new Prisma.Decimal(0),
              agencyId: context.agencyId ?? null,
              clientId: context.clientId ?? null,
              serviceId: context.serviceId ?? null,
            },
            {
              ledgerTransactionId: transacao.id,
              accountId: contaCredito.id,
              debit: new Prisma.Decimal(0),
              credit: valor,
              agencyId: context.agencyId ?? null,
              clientId: context.clientId ?? null,
              serviceId: context.serviceId ?? null,
            },
          ],
        });
        return transacao;
    };

    const criada = tx
      ? await escrever(tx)
      : await runWithoutScope(async () => prisma.$transaction(async (t) => escrever(t as any)));

    return { ok: true, posted: true, ledgerTransactionId: criada.id };
  } catch (e) {
    if (e instanceof PostingError) return { ok: false, error: e.message };
    // Corrida na chave de idempotência: outro processo postou primeiro.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { ok: true, posted: false, reason: "ja_postado" };
    throw e;
  }
}

/**
 * Neutraliza uma transação invertendo as contas dela (01 §3.10 "Reversal").
 * A original permanece: a história não é apagada.
 */
export async function reverse(
  ledgerTransactionId: string,
  motivo: string
): Promise<PostingResult> {
  const original = await runWithoutScope(async () =>
    prisma.ledgerTransaction.findUnique({
      where: { id: ledgerTransactionId },
      include: { entries: true },
    })
  );
  if (!original) return { ok: false, error: "Transação do razão não encontrada." };
  if (!motivo.trim()) return { ok: false, error: "Reversão exige motivo." };

  const jaRevertida = await runWithoutScope(async () =>
    prisma.ledgerTransaction.findFirst({
      where: { reversalOfId: original.id },
      select: { id: true },
    })
  );
  if (jaRevertida)
    return { ok: true, posted: false, reason: "ja_postado", ledgerTransactionId: jaRevertida.id };

  const criada = await runWithoutScope(async () =>
    prisma.$transaction(async (tx) => {
      const t = await tx.ledgerTransaction.create({
        data: {
          workspaceId: original.workspaceId,
          eventType: "REVERSAL",
          sourceType: "LedgerTransaction",
          sourceId: original.id,
          competence: original.competence,
          postedAt: new Date(),
          postingRuleVersion: POSTING_RULES_VERSION,
          idempotencyKey: `REVERSAL:LedgerTransaction:${original.id}`,
          reversalOfId: original.id,
          ownerId: original.ownerId,
        },
        select: { id: true },
      });
      await tx.ledgerEntry.createMany({
        // Débito vira crédito e vice-versa: a soma das duas transações é zero.
        data: original.entries.map((e) => ({
          ledgerTransactionId: t.id,
          accountId: e.accountId,
          debit: e.credit,
          credit: e.debit,
          agencyId: e.agencyId,
          clientId: e.clientId,
          serviceId: e.serviceId,
        })),
      });
      return t;
    })
  );
  return { ok: true, posted: true, ledgerTransactionId: criada.id };
}

/**
 * Conferência do razão (01 §5.4): toda transação fecha débito = crédito?
 * Roda no job de integridade e no checklist de fechamento.
 */
export async function checkLedgerBalance(
  workspaceId: string,
  competence?: Competence
): Promise<{ ok: boolean; transacoes: number; desbalanceadas: { id: string; diferenca: string }[] }> {
  const linhas = await runWithoutScope(async () =>
    prisma.$queryRaw<{ id: string; diferenca: Prisma.Decimal }[]>`
      SELECT t."id", SUM(e."debit") - SUM(e."credit") AS diferenca
        FROM "LedgerTransaction" t
        JOIN "LedgerEntry" e ON e."ledgerTransactionId" = t."id"
       WHERE t."workspaceId" = ${workspaceId}
         ${competence ? Prisma.sql`AND t."competence" = ${competence}` : Prisma.empty}
       GROUP BY t."id"
      HAVING SUM(e."debit") <> SUM(e."credit")
    `
  );
  const total = await runWithoutScope(async () =>
    prisma.ledgerTransaction.count({
      where: { workspaceId, ...(competence ? { competence } : {}) },
    })
  );
  return {
    ok: linhas.length === 0,
    transacoes: total,
    desbalanceadas: linhas.map((l) => ({ id: l.id, diferenca: String(l.diferenca) })),
  };
}

async function buscarConta(workspaceId: string, code: string) {
  const conta = await runWithoutScope(async () =>
    prisma.accountingAccount.findFirst({
      where: { workspaceId, code, active: true },
      select: {
        id: true, code: true, name: true, isPostingAccount: true,
        accountType: true, normalBalance: true, statementType: true,
      },
    })
  );
  if (!conta)
    throw new PostingError(`Conta "${code}" não existe no plano de contas do workspace.`);
  if (!conta.isPostingAccount)
    throw new PostingError(
      `Conta "${code}" é sintética (só agrega) e não recebe lançamento — 03 §2.2.`
    );
  return conta;
}

/**
 * GUARDA DE NATUREZA (F3.1 · ref. 01 §3.11).
 *
 * "O engine conhece a natureza (impede empréstimo/fatura/transferência
 * virarem despesa duplicada)."
 *
 * O ERRO QUE ISTO EVITA é o mais caro da contabilidade gerencial e o mais
 * difícil de perceber: dinheiro que SAI mas não é despesa. Pagar a fatura do
 * cartão, amortizar empréstimo e transferir para a reserva movimentam o
 * caixa e NÃO são custo — a compra no cartão já foi despesa quando foi feita,
 * o empréstimo já entrou como passivo, a reserva continua sendo da empresa.
 * Lançar qualquer um deles no resultado conta a mesma saída duas vezes, e o
 * DRE passa a mostrar um prejuízo que não existe.
 *
 * A regra é simples e vale nos dois sentidos:
 *   · regra que NÃO afeta a DRE não pode tocar em conta de resultado;
 *   · regra que AFETA a DRE tem de tocar em pelo menos uma.
 *
 * A segunda metade é tão importante quanto a primeira: uma despesa lançada
 * entre duas contas de balanço some do resultado sem ninguém notar.
 */
function conferirNatureza(
  eventType: string,
  afetaDre: boolean,
  debito: { code: string; name: string; statementType: string },
  credito: { code: string; name: string; statementType: string }
): void {
  const resultado = [debito, credito].filter((c) => c.statementType === "PNL");

  if (!afetaDre && resultado.length > 0) {
    const c = resultado[0];
    throw new PostingError(
      `"${eventType}" não afeta o resultado, mas a regra aponta para "${c.code} ${c.name}", que é conta de resultado. ` +
        `Isso contaria a mesma saída duas vezes no DRE.`
    );
  }
  if (afetaDre && resultado.length === 0) {
    throw new PostingError(
      `"${eventType}" afeta o resultado, mas nenhuma das contas ("${debito.code}" e "${credito.code}") é de resultado. ` +
        `O lançamento sumiria do DRE.`
    );
  }
}

export { toCompetence, POSTING_RULES_VERSION, LEDGER_FLAG };

/**
 * REVERSAL (F3.1 · ref. 01 §3.10, §3.12).
 *
 * "Contas inversas do original; conforme original; neutraliza."
 *
 * O reversal é o ÚNICO evento da matriz sem contas próprias, e por um motivo
 * que é a regra inteira: ele não sabe o que está desfazendo até olhar o
 * original. Dar a ele um par fixo de contas produziria um estorno que
 * neutraliza a transação errada — o razão fecharia e o DRE mentiria.
 *
 * Correção é sempre por reversal, nunca por edição (01 §2.14): a transação
 * original continua lá, e a leitura do mês passa a ser a soma das duas. É o
 * que permite responder "isto foi estornado" em vez de "isto nunca existiu".
 */
export async function reverter(
  ledgerTransactionId: string,
  /** Vai para a trilha de auditoria: o razão guarda o elo, não o texto. */
  motivo: string,
  tx?: TxClient
): Promise<PostingResult> {
  try {
    if (!motivo || motivo.trim().length < 3)
      throw new PostingError("Estorno exige motivo.");

    const original = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findUnique({
        where: { id: ledgerTransactionId },
        include: { entries: true },
      })
    );
    if (!original) throw new PostingError("Lançamento original não encontrado.");
    if (original.eventType === "REVERSAL")
      throw new PostingError("Estorno de estorno não existe — reponha o fato original.");

    const chave = `REVERSAL:LedgerTransaction:${original.id}:${original.competence}`;
    const jaEstornado = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({
        where: { workspaceId: original.workspaceId, idempotencyKey: chave },
        select: { id: true },
      })
    );
    if (jaEstornado)
      return { ok: true, posted: false, reason: "ja_postado", ledgerTransactionId: jaEstornado.id };

    if (!(await isLedgerEnabled(original.workspaceId)))
      return { ok: true, posted: false, reason: "flag_desligada" };

    const escrever = async (db: TxClient) => {
      const t = await db.ledgerTransaction.create({
        data: {
          workspaceId: original.workspaceId,
          eventType: "REVERSAL",
          sourceType: "LedgerTransaction",
          sourceId: original.id,
          // A COMPETÊNCIA É A DO ORIGINAL, não a de hoje: o estorno tem de
          // neutralizar o mês em que o erro entrou, senão sobra receita em um
          // mês e sobra estorno no outro, e nenhum dos dois fecha.
          competence: original.competence,
          postedAt: new Date(),
          postingRuleVersion: POSTING_RULES_VERSION,
          idempotencyKey: chave,
          ownerId: original.ownerId,
          // O elo formal com o original (§3.10). É `@unique`, então o banco
          // garante que uma transação só pode ser estornada UMA vez — dois
          // estornos do mesmo fato zerariam e depois inverteriam o sinal.
          reversalOfId: original.id,
        },
        select: { id: true },
      });
      await db.ledgerEntry.createMany({
        data: original.entries.map((e: any) => ({
          ledgerTransactionId: t.id,
          accountId: e.accountId,
          // Espelhado: o que era débito vira crédito e vice-versa.
          debit: e.credit,
          credit: e.debit,
          agencyId: e.agencyId,
          clientId: e.clientId,
          serviceId: e.serviceId,
        })),
      });
      return t;
    };

    const criada = tx
      ? await escrever(tx)
      : await runWithoutScope(async () => prisma.$transaction(async (t) => escrever(t as any)));

    return { ok: true, posted: true, ledgerTransactionId: criada.id };
  } catch (e) {
    if (e instanceof PostingError) return { ok: false, error: e.message };
    throw e;
  }
}
