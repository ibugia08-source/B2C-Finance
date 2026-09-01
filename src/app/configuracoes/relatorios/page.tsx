import { PageHeader } from "@/components/page-header";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { REPORTS } from "@/lib/reports/registry";
import { PainelDeAgendamentos } from "./painel";

/**
 * RELATÓRIOS AGENDADOS (F5.7).
 *
 * A tela guarda intenções; quem executa é a rotina diária. O texto diz
 * exatamente o que acontece — inclusive que, sem provedor de e-mail
 * configurado, os envios ficam na fila esperando, sem se perder.
 */
export const dynamic = "force-dynamic";

export default async function RelatoriosAgendadosPage() {
  const viewer = await requirePagePermission("configuracoes.visualizar");
  const agendamentos = await prisma.scheduledReport.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, reportKey: true, frequency: true, recipients: true,
      enabled: true, lastRunAt: true,
    },
  });

  return (
    <div>
      <PageHeader
        title="Relatórios agendados"
        description="Escolha um relatório e ele chega por e-mail toda semana ou todo mês, com o período anterior fechado"
      />
      <PainelDeAgendamentos
        agendamentos={agendamentos.map((a) => ({
          ...a,
          lastRunAt: a.lastRunAt?.toISOString() ?? null,
        }))}
        relatorios={REPORTS.map((r) => ({ key: r.key, title: r.title }))}
        podeEditar={can(viewer, "configuracoes.editar")}
      />
    </div>
  );
}
