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
  /** Projeção de 30 dias — vem de projecaoDeCaixa, nunca recalculada aqui. */
  projecao30d: number;
  /** Composição completa da projeção, para a tela abrir sem recalcular. */
  projecao: ProjecaoDeCaixa;
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

/**
 * PROJEÇÃO DE CAIXA POR HORIZONTE — fonte ÚNICA (DA-01 · auditoria 11/09/2026).
 *
 * O relatório encontrou "projeção 30 dias" com DOIS valores na mesma tela:
 * −R$ 107.643,06 no card de Liquidez e −R$ 26.548,53 no bloco "Atenção hoje".
 * Não era erro de conta: eram duas implementações independentes do mesmo
 * nome, e elas discordavam em três pontos —
 *
 *   1. ENTRADAS. A de "Atenção hoje" somava TODA cobrança aberta com
 *      vencimento até o limite, o que inclui o atrasado do passado inteiro.
 *      Contar como entrada garantida dos próximos 30 dias um valor que já
 *      venceu e não veio é a hipótese mais otimista possível — e era ela que
 *      deixava o alerta menos grave que o card ao lado.
 *   2. PASSIVO FINANCIADO. Só a de "Atenção hoje" descontava a parcela
 *      mensal das Liabilities.
 *   3. PARTIDA. Uma saía do saldo bruto, a outra do disponível.
 *
 * Esta função passa a ser a única, e ela é a CONSERVADORA: o vencido não
 * entra como entrada — fica reportado à parte, em `aReceberVencido`, para a
 * tela poder dizer que ele existe sem contar com ele. Quem quiser a hipótese
 * otimista soma os dois campos e diz que somou.
 *
 * Sem dupla contagem: a saída do horizonte inclui o que já venceu, então a
 * partida é sempre o saldo BRUTO das contas ativas, nunca o disponível (que
 * já desconta o vencido).
 */
export type ProjecaoDeCaixa = {
  horizonteDias: number;
  /** Saldo bruto das contas ativas — o ponto de partida. */
  partida: number;
  /** Cobranças que vencem de hoje até o limite. Entram na projeção. */
  aReceber: number;
  /** Cobranças JÁ VENCIDAS e em aberto. NÃO entram — só informam. */
  aReceberVencido: number;
  /** Contas a pagar até o limite, incluindo as já vencidas. */
  aPagar: number;
  /** Parcelas de passivo financiado no horizonte. */
  passivoFinanciado: number;
  /** partida + aReceber − aPagar − passivoFinanciado */
  projecao: number;
};

export async function projecaoDeCaixa(
  horizonteDias: number,
  hoje: Date = new Date()
): Promise<ProjecaoDeCaixa> {
  const inicio = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
  );
  const limite = new Date(inicio.getTime() + horizonteDias * 24 * 60 * 60 * 1000);
  // Parcela mensal conta uma vez por mês COMEÇADO dentro do horizonte.
  const meses = Math.ceil(horizonteDias / 30);

  const [contas, aReceber, vencido, aPagar, passivos] = await Promise.all([
    prisma.account.aggregate({ where: { active: true }, _sum: { balance: true } }),
    prisma.billing.aggregate({
      where: {
        status: { notIn: ["PAID", "CANCELED"] },
        dueDate: { gte: inicio, lt: limite },
      },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.billing.aggregate({
      where: {
        status: { notIn: ["PAID", "CANCELED"] },
        dueDate: { lt: inicio },
      },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.transaction.aggregate({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        OR: [{ dueDate: { lt: limite } }, { dueDate: null, date: { lt: limite } }],
      },
      _sum: { amount: true },
    }),
    prisma.liability.aggregate({
      where: { monthlyPayment: { not: null }, remainingValue: { gt: 0 } },
      _sum: { monthlyPayment: true },
    }),
  ]);

  const centavo = (v: number) => Math.round(v * 100) / 100;
  const emAberto = (a: { amount: unknown; paidTotal: unknown }) =>
    Math.max(0, n(a.amount) - n(a.paidTotal));

  const partida = centavo(n(contas._sum.balance));
  const entradas = centavo(emAberto(aReceber._sum));
  const entradasVencidas = centavo(emAberto(vencido._sum));
  const saidas = centavo(n(aPagar._sum.amount));
  const financiado = centavo(n(passivos._sum.monthlyPayment) * meses);

  return {
    horizonteDias,
    partida,
    aReceber: entradas,
    aReceberVencido: entradasVencidas,
    aPagar: saidas,
    passivoFinanciado: financiado,
    projecao: centavo(partida + entradas - saidas - financiado),
  };
}

async function getLiquidezImpl(hojeISO: string): Promise<Liquidez> {
  const hoje = new Date(hojeISO);
  const em30 = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);
  const janelaDias = await janelaDeCompromissoImediato();
  const limiteImediato = new Date(hoje.getTime() + janelaDias * 24 * 60 * 60 * 1000);

  const [contas, aPagar, proj] = await Promise.all([
    prisma.account.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { name: true, balance: true },
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
    // A projeção de 30 dias NÃO é calculada aqui: ela vem da fonte única,
    // a mesma que o alerta "Atenção hoje" e a página de projeções usam. Foi
    // ter duas contas com o mesmo nome que produziu a divergência da DA-01.
    projecaoDeCaixa(30, hoje),
  ]);

  const vencimento = (t: { dueDate: Date | null; date: Date }) => t.dueDate ?? t.date;
  const somaContas = contas.reduce((s, c) => s + n(c.balance), 0);
  // Vencida entra INTEIRA, por mais antiga que seja: dívida vencida não deixa
  // de ser compromisso porque envelheceu.
  const compromissos = aPagar
    .filter((t) => vencimento(t) < limiteImediato)
    .reduce((s, t) => s + n(t.amount), 0);
  const entradas30d = proj.aReceber;
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
    projecao30d: proj.projecao,
    projecao: proj,
  };
}

export const getLiquidez = ownerCached("liquidez", getLiquidezImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});
