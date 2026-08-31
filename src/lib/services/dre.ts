import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { toNumber as n } from "@/lib/format";
import type { Competence } from "@/lib/competence";

/**
 * DRE GERENCIAL (F3.2 · ref. 01 §3.11; 02 §4.5).
 *
 * "DRE usa apenas statementType=PNL." A fonte é o RAZÃO, e não as tabelas
 * operacionais — é o que separa este DRE de mais um relatório que soma
 * colunas por conta própria e discorda do painel na terceira casa.
 *
 * A CONSEQUÊNCIA HONESTA DISSO, e ela precisa aparecer na tela: enquanto um
 * evento da matriz não é emitido pelo produto, ele não está no razão e não
 * entra aqui. Um DRE que mostra receita e nenhuma despesa não está "quase
 * pronto" — está errado, e quem olhar tem de saber disso antes de tomar
 * decisão. Por isso o serviço devolve a COBERTURA junto com os números.
 *
 * DECIDIDO 19.12 (31/08): pró-labore fica DENTRO do resultado, porque é custo
 * real de operar — com uma chave para ver o resultado sem ele, que é a
 * pergunta legítima "quanto a operação dá antes da minha retirada".
 */

/** Conta do plano onde mora o pró-labore (7.5). */
const CONTA_PRO_LABORE = "7.5";

export type BaseDaDre = "competencia" | "caixa";

export type LinhaDre = {
  code: string;
  name: string;
  group: string;
  valor: number;
};

export type BlocoDre = {
  chave: string;
  titulo: string;
  /** Sinal com que o bloco entra no resultado. */
  sinal: 1 | -1;
  linhas: LinhaDre[];
  total: number;
};

export type Dre = {
  competence: string;
  base: BaseDaDre;
  agencyId: string | null;
  blocos: BlocoDre[];
  receitaOperacional: number;
  receitaTotal: number;
  custosDiretos: number;
  margemBruta: number;
  despesas: number;
  resultado: number;
  margem: number | null;
  /** Pró-labore isolado, para a chave de 19.12. */
  proLabore: number;
  resultadoSemProLabore: number;
  /** Quantas transações do razão entraram nesta leitura. */
  lancamentos: number;
  cobertura: CoberturaDre;
};

export type CoberturaDre = {
  /** O razão está ligado neste ambiente? */
  ligado: boolean;
  /** Eventos da matriz que ainda não foram emitidos NENHUMA vez. */
  eventosSemUso: string[];
  /** Receita medida pelo motor de métricas, para comparação. */
  receitaOperacionalMedida: number | null;
  /** A diferença entre o razão e a medida operacional. */
  diferenca: number | null;
};

const BLOCOS: { chave: string; titulo: string; sinal: 1 | -1; prefixos: string[] }[] = [
  { chave: "receita_operacional", titulo: "Receitas operacionais", sinal: 1, prefixos: ["4"] },
  { chave: "receita_extra", titulo: "Receitas extras", sinal: 1, prefixos: ["5"] },
  { chave: "custos_diretos", titulo: "Custos diretos", sinal: -1, prefixos: ["6"] },
  { chave: "folha", titulo: "Folha e pessoas", sinal: -1, prefixos: ["7"] },
  { chave: "ferramentas", titulo: "Ferramentas e softwares", sinal: -1, prefixos: ["8"] },
  { chave: "marketing", titulo: "Marketing e vendas da agência", sinal: -1, prefixos: ["9"] },
  { chave: "administrativas", titulo: "Administrativas", sinal: -1, prefixos: ["10"] },
  { chave: "impostos", titulo: "Impostos e contabilidade", sinal: -1, prefixos: ["11"] },
  { chave: "financeiras", titulo: "Financeiras", sinal: -1, prefixos: ["12"] },
  { chave: "ajustes", titulo: "Ajustes, contra-receita e perdas", sinal: -1, prefixos: ["14"] },
  { chave: "nao_classificado", titulo: "Não classificado", sinal: -1, prefixos: ["99"] },
];

function blocoDe(code: string): string {
  const raiz = code.split(".")[0];
  const b = BLOCOS.find((x) => x.prefixos.includes(raiz));
  return b?.chave ?? "nao_classificado";
}

export async function montarDre(
  competence: Competence | string,
  opts: {
    base?: BaseDaDre;
    agencyId?: string | null;
    /** 19.12: false esconde o pró-labore do resultado (leitura informativa). */
    comProLabore?: boolean;
  } = {}
): Promise<Dre> {
  const base = opts.base ?? "competencia";
  const workspaceId = await currentWorkspaceId();
  const [ano, mes] = competence.split("-").map(Number);

  // COMPETÊNCIA lê pelo campo competence; CAIXA lê pelo instante do
  // lançamento. São perguntas diferentes e a tela tem de dizer qual está
  // respondendo — trocar uma pela outra sem avisar é como o v1 produzia dois
  // "resultado do mês" que nunca batiam.
  const filtroDoPeriodo =
    base === "competencia"
      ? { competence }
      : {
          postedAt: {
            gte: new Date(ano, mes - 1, 1),
            lt: new Date(ano, mes, 1),
          },
        };

  const entradas = await runWithoutScope(async () =>
    prisma.ledgerEntry.findMany({
      where: {
        ledgerTransaction: { workspaceId, ...filtroDoPeriodo },
        ...(opts.agencyId ? { agencyId: opts.agencyId } : {}),
        account: { statementType: "PNL" },
      },
      select: {
        debit: true,
        credit: true,
        ledgerTransactionId: true,
        account: { select: { code: true, name: true, group: true, accountType: true } },
      },
    })
  );

  const porConta = new Map<string, LinhaDre>();
  const transacoes = new Set<string>();
  for (const e of entradas) {
    transacoes.add(e.ledgerTransactionId);
    const a = e.account;
    // RECEITA é natureza credora: crédito soma, débito (estorno) subtrai.
    // DESPESA é o contrário. Sem isso o estorno apareceria como receita
    // negativa em despesa e vice-versa, e as duas colunas mentiriam.
    const valor =
      a.accountType === "REVENUE"
        ? n(e.credit) - n(e.debit)
        : n(e.debit) - n(e.credit);
    const atual = porConta.get(a.code);
    if (atual) atual.valor += valor;
    else
      porConta.set(a.code, {
        code: a.code,
        name: a.name,
        group: a.group ?? "",
        valor,
      });
  }

  const blocos: BlocoDre[] = BLOCOS.map((b) => {
    const linhas = [...porConta.values()]
      .filter((l) => blocoDe(l.code) === b.chave)
      .sort((x, y) => x.code.localeCompare(y.code, "pt-BR", { numeric: true }));
    return {
      chave: b.chave,
      titulo: b.titulo,
      sinal: b.sinal,
      linhas,
      total: linhas.reduce((s, l) => s + l.valor, 0),
    };
  });

  const totalDe = (chave: string) => blocos.find((b) => b.chave === chave)?.total ?? 0;

  const proLabore = porConta.get(CONTA_PRO_LABORE)?.valor ?? 0;
  const comProLabore = opts.comProLabore ?? true;

  const receitaOperacional = totalDe("receita_operacional");
  const receitaTotal = receitaOperacional + totalDe("receita_extra");
  const custosDiretos = totalDe("custos_diretos");
  const margemBruta = receitaTotal - custosDiretos;

  const despesasBrutas = blocos
    .filter((b) => b.sinal === -1 && b.chave !== "custos_diretos")
    .reduce((s, b) => s + b.total, 0);
  const despesas = comProLabore ? despesasBrutas : despesasBrutas - proLabore;

  const resultado = margemBruta - despesas;

  return {
    competence,
    base,
    agencyId: opts.agencyId ?? null,
    blocos,
    receitaOperacional,
    receitaTotal,
    custosDiretos,
    margemBruta,
    despesas,
    resultado,
    margem: receitaOperacional > 0 ? resultado / receitaOperacional : null,
    proLabore,
    resultadoSemProLabore: margemBruta - (despesasBrutas - proLabore),
    lancamentos: transacoes.size,
    cobertura: await medirCobertura(workspaceId, receitaOperacional, competence),
  };
}

/**
 * A cobertura é parte do resultado, não um extra.
 *
 * Um DRE tirado de um razão que cobre metade dos fatos não está "quase
 * pronto": está errado. Quem abre a tela precisa saber disso ANTES de tomar
 * decisão, e a comparação com o número que o painel mostra é a forma mais
 * direta de dizer.
 */
async function medirCobertura(
  workspaceId: string,
  receitaDoRazao: number,
  competence: string
): Promise<CoberturaDre> {
  const { POSTING_RULES } = await import("@/lib/accounting/posting-rules");
  const { isLedgerEnabled } = await import("@/lib/accounting/engine");

  const [ligado, usados] = await Promise.all([
    isLedgerEnabled(workspaceId),
    runWithoutScope(async () =>
      prisma.ledgerTransaction.groupBy({ by: ["eventType"], where: { workspaceId } })
    ),
  ]);
  const comUso = new Set(usados.map((u) => u.eventType));

  let receitaMedida: number | null = null;
  try {
    const [ano, mes] = competence.split("-").map(Number);
    const { computePeriodMetrics } = await import("@/lib/metrics/engine");
    const m = await computePeriodMetrics({
      start: new Date(ano, mes - 1, 1),
      end: new Date(ano, mes, 1),
    } as any);
    receitaMedida = (m as any).faturamento_total?.value ?? null;
  } catch {
    /* sem métricas disponíveis: a comparação some, o resto continua */
  }

  return {
    ligado,
    eventosSemUso: POSTING_RULES.filter((r) => !comUso.has(r.eventType)).map((r) => r.eventType),
    receitaOperacionalMedida: receitaMedida,
    diferenca: receitaMedida == null ? null : Math.round((receitaDoRazao - receitaMedida) * 100) / 100,
  };
}

/**
 * Linhas planas para exportação ao contador.
 *
 * Vírgula decimal e ponto e vírgula como separador: é o que o Excel em
 * português abre sem perguntar nada. E a conversão é feita AQUI, número a
 * número — trocar todo ponto por vírgula no arquivo pronto transformaria o
 * código de conta "4.1" em "4,1" e o contador receberia um plano de contas
 * que não existe.
 */
const brl = (v: number) => v.toFixed(2).replace(".", ",");

export function dreParaCsv(dre: Dre): string {
  const linhas: string[] = ["bloco;conta;nome;valor"];
  for (const b of dre.blocos) {
    for (const l of b.linhas) {
      linhas.push(`${b.titulo};${l.code};${l.name};${brl(l.valor)}`);
    }
  }
  linhas.push(`;;Receita total;${brl(dre.receitaTotal)}`);
  linhas.push(`;;Custos diretos;${brl(dre.custosDiretos)}`);
  linhas.push(`;;Margem bruta;${brl(dre.margemBruta)}`);
  linhas.push(`;;Despesas;${brl(dre.despesas)}`);
  linhas.push(`;;Resultado;${brl(dre.resultado)}`);
  return linhas.join("\n");
}
