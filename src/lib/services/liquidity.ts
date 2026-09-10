import { prisma } from "@/lib/prisma";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { toNumber as n } from "@/lib/format";

/**
 * LIQUIDEZ DISPONÍVEL — versão 2 (01 §7.2; 02 §5.1 — sexto card do painel).
 *
 * A versão 1 descontava as RESERVAS RESTRITAS (CashBox), e as reservas saíram
 * do produto em 10/09/2026. A pergunta que o card responde não mudou —
 * "quanto dá para gastar hoje?" —, mudou de onde vem a restrição:
 *
 *   v1: contas + reservas − reservas restritas
 *   v2: contas ATIVAS − compromissos imediatos
 *
 * COMPROMISSO IMEDIATO é a conta a pagar que já venceu ou vence dentro da
 * janela configurada (padrão 7 dias). Esse dinheiro tem dono e tem data, do
 * mesmo jeito que a reserva de imposto tinha — a diferença é que agora ele é
 * um FATO lançado no sistema, e não uma intenção que alguém precisava lembrar
 * de registrar numa caixinha. Reserva era a promessa; a conta a pagar é a
 * dívida.
 *
 * POR QUE A JANELA É CURTA E NÃO 30 DIAS: o card responde "posso gastar
 * agora". Descontar tudo o que vence no mês transformaria o disponível em
 * saldo de fim de mês, que é outra pergunta — e que a projeção de 30 dias,
 * logo abaixo no mesmo card, já responde separadamente.
 *
 * A projeção de 30 dias segue igual e igualmente conservadora:
 *   entradas = cobranças em aberto que vencem nos próximos 30 dias
 *   saídas   = despesas não pagas com vencimento nos próximos 30 dias
 * É previsão de CAIXA, não de competência.
 */

/** Janela padrão do compromisso imediato, em dias. */
export const JANELA_COMPROMISSO_PADRAO = 7;

export type Liquidez = {
  contas: number;
  /** Contas a pagar vencidas ou vencendo dentro da janela — sai do disponível. */
  compromissos: number;
  /** Janela usada nesta apuração, em dias (configurável por workspace). */
  janelaDias: number;
  disponivel: number;
  /** Composição para o detalhe do card: as contas e o compromisso, aberto. */
  itens: {
    label: string;
    value: number;
    tipo: "conta" | "compromisso";
  }[];
  entradas30d: number;
  saidas30d: number;
  projecao30d: number;
};

/**
 * Janela do compromisso imediato, em dias, lida de Workspace.financeSettings.
 *
 * Fora de uma requisição (scripts, testes) cai no padrão em vez de estourar:
 * a liquidez é lida em tela, em relatório e em rotina, e uma configuração
 * ausente não pode derrubar nenhum dos três.
 */
export async function janelaDeCompromissoImediato(): Promise<number> {
  try {
    const id = await currentWorkspaceId();
    const w = await runWithoutScope(async () =>
      prisma.workspace.findUnique({ where: { id }, select: { financeSettings: true } })
    );
    const cfg = (w?.financeSettings ?? {}) as Record<string, unknown>;
    const dias = Number(cfg.compromissosImediatosDias);
    return Number.isFinite(dias) && dias >= 0 && dias <= 90
      ? Math.trunc(dias)
      : JANELA_COMPROMISSO_PADRAO;
  } catch {
    return JANELA_COMPROMISSO_PADRAO;
  }
}

/** Grava a janela (0 a 90 dias). Sem tela ainda — mesma via da base do ROAS. */
export async function definirJanelaDeCompromisso(dias: number) {
  if (!Number.isFinite(dias) || dias < 0 || dias > 90)
    return { ok: false as const, error: "A janela precisa estar entre 0 e 90 dias." };
  const id = await currentWorkspaceId();
  await runWithoutScope(async () =>
    prisma.workspace.update({
      where: { id },
      data: { financeSettings: { compromissosImediatosDias: Math.trunc(dias) } },
    })
  );
  return { ok: true as const };
}

async function getLiquidezImpl(hojeISO: string): Promise<Liquidez> {
  const hoje = new Date(hojeISO);
  const em30 = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);
  const janelaDias = await janelaDeCompromissoImediato();
  const limiteImediato = new Date(hoje.getTime() + janelaDias * 24 * 60 * 60 * 1000);

  const [contas, aReceber, aPagar] = await Promise.all([
    prisma.account.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { name: true, balance: true },
    }),
    prisma.billing.findMany({
      where: {
        status: { notIn: ["PAID", "CANCELED"] },
        dueDate: { gte: hoje, lt: em30 },
      },
      select: { amount: true, paidTotal: true },
    }),
    // Uma leitura só serve às duas contas: o compromisso imediato é o
    // subconjunto que já venceu ou vence dentro da janela. Buscar duas vezes
    // abriria espaço para os dois números discordarem entre si.
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        OR: [{ dueDate: { lt: em30 } }, { dueDate: null, date: { lt: em30 } }],
      },
      select: { amount: true, dueDate: true, date: true },
    }),
  ]);

  const vencimento = (t: { dueDate: Date | null; date: Date }) => t.dueDate ?? t.date;
  const somaContas = contas.reduce((s, c) => s + n(c.balance), 0);
  // Vencida entra INTEIRA, por mais antiga que seja: dívida vencida não deixa
  // de ser compromisso porque envelheceu.
  const compromissos = aPagar
    .filter((t) => vencimento(t) < limiteImediato)
    .reduce((s, t) => s + n(t.amount), 0);
  const entradas30d = aReceber.reduce(
    (s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)),
    0
  );
  const saidas30d = aPagar
    .filter((t) => vencimento(t) >= hoje && vencimento(t) < em30)
    .reduce((s, t) => s + n(t.amount), 0);

  const centavo = (v: number) => Math.round(v * 100) / 100;
  const disponivel = centavo(somaContas - compromissos);

  return {
    contas: centavo(somaContas),
    compromissos: centavo(compromissos),
    janelaDias,
    disponivel,
    itens: [
      ...contas.map((c) => ({
        label: c.name, value: n(c.balance), tipo: "conta" as const,
      })),
      ...(compromissos > 0
        ? [{
            label:
              janelaDias === 0
                ? "Contas a pagar vencidas"
                : `Contas a pagar vencidas e até ${janelaDias} dias`,
            value: -centavo(compromissos),
            tipo: "compromisso" as const,
          }]
        : []),
    ],
    entradas30d: centavo(entradas30d),
    saidas30d: centavo(saidas30d),
    projecao30d: centavo(disponivel + entradas30d - saidas30d),
  };
}

export const getLiquidez = ownerCached("liquidez", getLiquidezImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});
