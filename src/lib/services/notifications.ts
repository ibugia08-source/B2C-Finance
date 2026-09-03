import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { toNumber as n, formatBRL } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";

/**
 * CENTRAL DE NOTIFICAÇÕES (F1.19 · ref. 02 §4.7; 01 §4.10).
 *
 * O CATÁLOGO é declarado — evento, destino, severidade — porque notificação
 * fora de catálogo é como métrica fora de registry: ninguém sabe por que
 * chegou nem como desligar. As REGRAS ANTI-FADIGA da spec, na ordem:
 *
 *  1. AGRUPAMENTO POR ORIGEM: "n vencidas = 1 notificação com contagem".
 *     Garantido pela unique (destinatário, evento, dia) — o gerador ATUALIZA
 *     a linha do dia em vez de criar outra.
 *  2. TETO DIÁRIO (padrão 15): o que passar do teto nasce como DIGEST e mora
 *     no resumo do dia, não na lista — o sino não vira spam.
 *  3. A caixa de aprovações NÃO existe (decisão 19.35/19.36) — a central é
 *     só de avisos.
 *
 * O gerador roda no caminho de leitura com trava de frequência (mesmo
 * desenho do ensureMonthlyBillings): "acontece sozinho" sem depender de cron,
 * e reexecutar no mesmo dia só atualiza contagens.
 */

export const TETO_DIARIO = 15;

type Achado = {
  event: string;
  title: string;
  detail: string;
  link: string;
  severity: "critica" | "alta" | "media";
  /** Permissão que define QUEM recebe (02 §4.7: destinatário padrão). */
  permissao: string;
  count: number;
};

/** As leituras do catálogo que têm fonte de dado real hoje. */
async function achadosDoDia(hoje: Date): Promise<Achado[]> {
  const out: Achado[] = [];
  const d0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const em3 = new Date(d0.getTime() + 3 * 86_400_000);
  const em30 = new Date(d0.getTime() + 30 * 86_400_000);

  const [vencidas, aPagar, renovacoes, avaliacoesPendentes, onboardingVencido, deadLetter] =
    await Promise.all([
      prisma.billing.aggregate({
        where: {
          status: { in: [...BILLING_OPEN_STATUSES] },
          dueDate: { lt: d0 },
          canceledAt: null,
        },
        _count: { _all: true },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.transaction.aggregate({
        where: {
          type: "despesa",
          status: "pendente",
          dueDate: { gte: d0, lte: em3 },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.contract.count({
        where: { status: "ACTIVE", renewalDate: { gte: d0, lte: em30 } },
      }),
      hoje.getDate() >= 25
        ? (async () => {
            const competencia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
            const ativas = await prisma.clientAgencyRelationship.count({
              where: { lifecycleStatus: { in: ["ACTIVE", "ONBOARDING"] } },
            });
            const feitas = await prisma.avaliacaoMensal.count({
              where: { competence: competencia },
            });
            return Math.max(0, ativas - feitas);
          })()
        : Promise.resolve(0),
      prisma.onboardingTask.count({
        where: { doneAt: null, dueAt: { lt: d0 } },
      }),
      prisma.outboxEvent.count({ where: { status: "DEAD_LETTER" } }),
    ]);

  const totalVencido = n(vencidas._sum.amount) - n(vencidas._sum.paidTotal);
  if (vencidas._count._all > 0 && totalVencido > 0.005) {
    out.push({
      event: "cobranca_vencida",
      title: "Cobranças vencidas",
      detail: `${vencidas._count._all} em aberto somando ${formatBRL(totalVencido)}.`,
      link: "/fila",
      severity: "alta",
      permissao: "recebimentos.ver_inadimplencia",
      count: vencidas._count._all,
    });
  }
  if (aPagar._count._all > 0) {
    out.push({
      event: "pagar_d3",
      title: "Despesas vencendo em 3 dias",
      detail: `${aPagar._count._all} conta(s) somando ${formatBRL(n(aPagar._sum.amount))}.`,
      link: "/despesas",
      severity: "media",
      permissao: "despesas.visualizar",
      count: aPagar._count._all,
    });
  }
  if (renovacoes > 0) {
    out.push({
      event: "contrato_renovacao",
      title: "Contratos a renovar em 30 dias",
      detail: `${renovacoes} contrato(s) chegando ao fim da vigência.`,
      link: "/renovacoes",
      severity: "media",
      permissao: "clientes.visualizar",
      count: renovacoes,
    });
  }
  if (avaliacoesPendentes > 0) {
    out.push({
      event: "avaliacao_pendente",
      title: "Avaliações do mês pendentes",
      detail: `${avaliacoesPendentes} cliente(s) sem avaliação — o mês está acabando.`,
      link: "/avaliacoes",
      severity: "media",
      permissao: "clientes.visualizar",
      count: avaliacoesPendentes,
    });
  }
  if (onboardingVencido > 0) {
    out.push({
      event: "onboarding_vencido",
      title: "Implantação fora do prazo",
      detail: `${onboardingVencido} tarefa(s) de implantação vencida(s).`,
      link: "/clientes",
      severity: "alta",
      permissao: "clientes.visualizar",
      count: onboardingVencido,
    });
  }
  // T7 — orçamento de experiência estourado (03 §4.7). Fonte: as medições
  // em memória do processo; só alerta com amostra suficiente.
  const { resumoDeMedicoes } = await import("@/lib/observability");
  const estourados = resumoDeMedicoes().filter((m) => m.estourado);
  if (estourados.length > 0) {
    out.push({
      event: "p95_estourado",
      title: "Telas acima do orçamento de tempo",
      detail: estourados
        .map((m) => `${m.chave}: p95 ${m.p95}ms (teto ${m.orcamentoMs}ms)`)
        .join("; "),
      link: "/configuracoes/observabilidade",
      severity: "alta",
      permissao: "configuracoes.visualizar",
      count: estourados.length,
    });
  }

  if (deadLetter > 0) {
    out.push({
      event: "envio_falhou",
      title: "Envios que desistiram",
      detail: `${deadLetter} evento(s) de integração esgotaram as tentativas.`,
      link: "/configuracoes",
      severity: "critica",
      permissao: "configuracoes.visualizar",
      count: deadLetter,
    });
  }
  return out;
}

const diaDe = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Materializa as notificações do dia para TODOS os usuários com a permissão
 * de cada evento. Idempotente por desenho: reexecutar atualiza contagens.
 */
export async function gerarNotificacoesDoDia(hoje: Date = new Date()): Promise<{ geradas: number }> {
  const { runWithoutScope, runWithOwner } = await import("@/lib/auth/owner-scope");

  // Os DADOS avaliados são os da conta — e fora de requisição não há dono
  // resolvido (a extensão falha fechada e leria zero de tudo). O dono da
  // conta é o do workspace, mesmo caminho dos webhooks (F4.8).
  const ws = await runWithoutScope(async () =>
    prisma.workspace.findFirst({ select: { ownerId: true } })
  );
  if (!ws?.ownerId) return { geradas: 0 };
  const achados = await runWithOwner(ws.ownerId, () => achadosDoDia(hoje));
  if (achados.length === 0) return { geradas: 0 };
  const usuarios = await runWithoutScope(async () =>
    prisma.user.findMany({
      where: { active: true },
      select: {
        id: true, role: true,
        permissions: { select: { permission: true, enabled: true } },
      },
    })
  );

  const dia = diaDe(hoje);
  let geradas = 0;

  for (const u of usuarios) {
    // hasPermission espera as linhas de override como vêm do banco.
    const viewer = { role: u.role, permissions: u.permissions } as any;
    const dele = achados.filter((a) => hasPermission(viewer, a.permissao));
    if (dele.length === 0) continue;

    const jaExistentes = await runWithoutScope(async () =>
      prisma.notification.count({
        where: { recipientId: u.id, day: dia, digest: false },
      })
    );

    let vivas = jaExistentes;
    for (const a of dele) {
      const existente = await runWithoutScope(async () =>
        prisma.notification.findFirst({
          where: { recipientId: u.id, event: a.event, day: dia },
          select: { id: true, digest: true },
        })
      );
      if (existente) {
        await runWithoutScope(async () =>
          prisma.notification.update({
            where: { id: existente.id },
            data: { title: a.title, detail: a.detail, count: a.count, severity: a.severity },
          })
        );
        continue;
      }
      // TETO DIÁRIO: a 16ª do dia nasce como digest — crítica fura o teto.
      const digest = a.severity !== "critica" && vivas >= TETO_DIARIO;
      await runWithoutScope(async () =>
        prisma.notification.create({
          data: {
            event: a.event, recipientId: u.id, title: a.title, detail: a.detail,
            link: a.link, severity: a.severity, day: dia, count: a.count, digest,
            ownerId: u.id,
          },
        })
      );
      if (!digest) vivas += 1;
      geradas += 1;
    }
  }
  return { geradas };
}

// Trava de frequência em memória (mesmo desenho do ensureMonthlyBillings).
const ENSURE_TTL_MS = 15 * 60 * 1000;
let lastEnsureAt = 0;
let lastEnsureDay = "";

export async function ensureNotificacoesDoDia(): Promise<void> {
  const agora = new Date();
  const dia = diaDe(agora);
  if (dia === lastEnsureDay && Date.now() - lastEnsureAt < ENSURE_TTL_MS) return;
  lastEnsureAt = Date.now();
  lastEnsureDay = dia;
  await gerarNotificacoesDoDia(agora).catch(() => {
    // Notificação nunca derruba a página que a acionou.
  });
}

export type NotificacaoDaCentral = {
  id: string;
  event: string;
  title: string;
  detail: string | null;
  link: string | null;
  severity: string;
  count: number;
  digest: boolean;
  lida: boolean;
  quando: Date;
};

export async function notificacoesDe(
  recipientId: string,
  dias = 14
): Promise<{ lista: NotificacaoDaCentral[]; naoLidas: number }> {
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  const corte = new Date(Date.now() - dias * 86_400_000);
  const linhas = await runWithoutScope(async () =>
    prisma.notification.findMany({
      where: { recipientId, createdAt: { gte: corte } },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    })
  );
  return {
    lista: linhas.map((l) => ({
      id: l.id, event: l.event, title: l.title, detail: l.detail, link: l.link,
      severity: l.severity, count: l.count, digest: l.digest,
      lida: l.readAt != null, quando: l.updatedAt,
    })),
    naoLidas: linhas.filter((l) => l.readAt == null && !l.digest).length,
  };
}

export async function contarNaoLidas(recipientId: string): Promise<number> {
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  return runWithoutScope(async () =>
    prisma.notification.count({ where: { recipientId, readAt: null, digest: false } })
  );
}

export async function marcarLida(recipientId: string, id: string) {
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  await runWithoutScope(async () =>
    prisma.notification.updateMany({
      // O destinatário no where: ninguém marca lida a notificação do outro.
      where: { id, recipientId },
      data: { readAt: new Date() },
    })
  );
  return { ok: true as const };
}

export async function marcarTodasLidas(recipientId: string) {
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  await runWithoutScope(async () =>
    prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    })
  );
  return { ok: true as const };
}
