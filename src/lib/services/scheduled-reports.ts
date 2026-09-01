import { prisma } from "@/lib/prisma";
import { runWithoutScope, runWithOwner } from "@/lib/auth/owner-scope";
import { getReport, REPORTS } from "@/lib/reports/registry";
import { renderEmail } from "@/lib/email/template";
import { formatBRL } from "@/lib/format";
import { publish } from "@/lib/outbox";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * RELATÓRIOS AGENDADOS (F5.7 · ref. 03 roadmap Fase 5; 02 §7.8 para o e-mail).
 *
 * O agendamento guarda a intenção ("margem, toda semana, para estes dois
 * e-mails"); o script de rotina EXECUTA — monta o relatório do período
 * anterior, veste o tema de e-mail e publica no Outbox. A entrega é problema
 * do worker, como sempre: sem provedor de e-mail configurado, o envio espera
 * SEM se perder e sem travar nada.
 *
 * A JANELA É RECUPERÁVEL, como a régua (F3.9): "semanal" não significa
 * "roda segunda-feira", significa "uma vez por semana-calendário". O script
 * que rodar quarta, depois de um feriado, manda o da semana — e não manda
 * de novo na quinta, porque o lastRunAt guarda a janela já coberta.
 */

export const FREQUENCIAS = ["SEMANAL", "MENSAL"] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function agendarRelatorio(input: {
  reportKey: string;
  frequency: Frequencia;
  recipients: string[];
  createdBy?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!getReport(input.reportKey))
    return { ok: false, error: "Este relatório não existe." };
  if (!FREQUENCIAS.includes(input.frequency))
    return { ok: false, error: "Escolha a frequência: semanal ou mensal." };
  const emails = [...new Set(input.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0)
    return { ok: false, error: "Informe ao menos um e-mail de destino." };
  const invalido = emails.find((e) => !EMAIL_RE.test(e));
  if (invalido) return { ok: false, error: `“${invalido}” não parece um e-mail.` };

  const igual = await prisma.scheduledReport.findFirst({
    where: { reportKey: input.reportKey, frequency: input.frequency },
    select: { id: true },
  });
  if (igual) {
    // Mesmo relatório na mesma frequência ATUALIZA os destinatários — dois
    // agendamentos iguais mandariam o mesmo e-mail duas vezes.
    await prisma.scheduledReport.update({
      where: { id: igual.id },
      data: { recipients: emails, enabled: true },
    });
    return { ok: true, id: igual.id };
  }
  const r = await prisma.scheduledReport.create({
    data: {
      reportKey: input.reportKey,
      frequency: input.frequency,
      recipients: emails,
      createdBy: input.createdBy ?? null,
    },
    select: { id: true },
  });
  return { ok: true, id: r.id };
}

export async function removerAgendamento(id: string) {
  await prisma.scheduledReport.delete({ where: { id } }).catch(() => null);
  return { ok: true as const };
}

/** A janela que um agendamento cobre AGORA, e desde quando ela está aberta. */
export function janelaDe(frequency: Frequencia, agora: Date) {
  if (frequency === "MENSAL") {
    const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const start = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    return {
      abertaDesde: inicioDoMes,
      start,
      end: inicioDoMes,
      rotulo: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    };
  }
  // Semana começa na segunda (getDay: 0=domingo).
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const recuo = (hoje.getDay() + 6) % 7;
  const inicioDaSemana = new Date(hoje.getTime() - recuo * 86_400_000);
  const start = new Date(inicioDaSemana.getTime() - 7 * 86_400_000);
  const rotulo = `semana-${start.toISOString().slice(0, 10)}`;
  return { abertaDesde: inicioDaSemana, start, end: inicioDaSemana, rotulo };
}

export type ResultadoDaRodada = {
  examinados: number;
  enviados: number;
  pulados: { id: string; motivo: string }[];
};

/**
 * Roda TODOS os agendamentos devidos — é a função que o script de rotina
 * chama. Cada agendamento roda sob o próprio dono: relatório é dado privado.
 */
export async function executarAgendamentos(agora: Date = new Date()): Promise<ResultadoDaRodada> {
  const todos = await runWithoutScope(async () =>
    prisma.scheduledReport.findMany({
      where: { enabled: true },
      select: {
        id: true, reportKey: true, frequency: true, recipients: true,
        lastRunAt: true, ownerId: true,
      },
    })
  );

  const resultado: ResultadoDaRodada = { examinados: todos.length, enviados: 0, pulados: [] };

  for (const s of todos) {
    const janela = janelaDe(s.frequency as Frequencia, agora);
    if (s.lastRunAt && s.lastRunAt >= janela.abertaDesde) {
      resultado.pulados.push({ id: s.id, motivo: "Janela já coberta." });
      continue;
    }
    if (!s.ownerId) {
      resultado.pulados.push({ id: s.id, motivo: "Agendamento sem dono." });
      continue;
    }
    try {
      await runWithOwner(s.ownerId, async () => {
        await executarUm(s, janela, agora);
      });
      resultado.enviados += 1;
    } catch (e: any) {
      // Um agendamento quebrado não derruba a rodada dos outros.
      resultado.pulados.push({ id: s.id, motivo: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return resultado;
}

async function executarUm(
  s: { id: string; reportKey: string; frequency: string; recipients: string[] },
  janela: { start: Date; end: Date; rotulo: string },
  agora: Date
) {
  const def = getReport(s.reportKey);
  if (!def) throw new Error(`Relatório “${s.reportKey}” não existe mais.`);

  const linhas = await def.build({
    period: { key: "custom", start: janela.start, end: janela.end, label: janela.rotulo },
  } as any);

  const colunasDinheiro = def.columns.filter((c: any) => c.kind === "money" && c.total);
  const totais = colunasDinheiro.map((c: any) => ({
    rotulo: c.label,
    valor: formatBRL(
      linhas.reduce((soma: number, l: any) => soma + (typeof l[c.key] === "number" ? l[c.key] : 0), 0)
    ),
  }));

  const periodoLegivel =
    s.frequency === "MENSAL"
      ? `competência ${janela.rotulo}`
      : `semana de ${new Intl.DateTimeFormat("pt-BR").format(janela.start)} a ${new Intl.DateTimeFormat("pt-BR").format(new Date(janela.end.getTime() - 86_400_000))}`;

  const html = renderEmail({
    titulo: def.title,
    preheader: `${def.title} — ${periodoLegivel}, ${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"}.`,
    paragrafos: [
      `Este é o envio ${s.frequency === "MENSAL" ? "mensal" : "semanal"} do relatório “${def.title}” (${periodoLegivel}).`,
      linhas.length === 0
        ? "O período não teve movimento para este relatório."
        : `O período fechou com ${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"}. Os totais estão abaixo; o detalhe completo está no sistema.`,
    ],
    destaque: totais,
    rodape: [
      "Enviado automaticamente pelo B2C Finance conforme o agendamento configurado.",
      "Para mudar destinatários ou cancelar, acesse Configurações → Relatórios agendados.",
    ],
  });

  const workspaceId = await currentWorkspaceId();

  // As chaves já publicadas saem ANTES da transação. O publish até engole o
  // P2002 no cliente, mas o Postgres aborta a transação inteira no primeiro
  // erro — e o update do lastRunAt logo abaixo morreria junto. A unique do
  // outbox continua sendo a trava dura para a corrida que escapar daqui: a
  // transação falha, e a PRÓXIMA rodada recupera.
  const chaves = s.recipients.map(
    (d) => `SCHEDULED_REPORT:${s.id}:${janela.rotulo}:${d}`
  );
  const publicadas = new Set(
    (
      await prisma.outboxEvent.findMany({
        where: { dedupeKey: { in: chaves } },
        select: { dedupeKey: true },
      })
    ).map((e) => e.dedupeKey)
  );

  await prisma.$transaction(async (tx) => {
    for (const destinatario of s.recipients) {
      const dedupeKey = `SCHEDULED_REPORT:${s.id}:${janela.rotulo}:${destinatario}`;
      if (publicadas.has(dedupeKey)) continue;
      await publish(tx as any, {
        workspaceId,
        eventType: "SCHEDULED_REPORT",
        channel: "email",
        sourceType: "ScheduledReport",
        sourceId: s.id,
        dedupeKey,
        payload: { to: destinatario, subject: `${def.title} — ${periodoLegivel}`, html },
      });
    }
    // Carimba o MESMO relógio que decidiu a janela — carimbar o relógio da
    // máquina quebraria a guarda em teste e em reprocesso de período antigo.
    await tx.scheduledReport.update({ where: { id: s.id }, data: { lastRunAt: agora } });
  });
}
