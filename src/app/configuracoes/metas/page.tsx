import { PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { metasDoMes } from "@/lib/services/commercial-goals";
import { PainelDeMetas } from "./painel";

/**
 * METAS COMERCIAIS (F4.5 · ref. 02 §5.4).
 *
 * Uma meta por mês, escopo e métrica. O sistema NUNCA inventa uma: sem linha
 * cadastrada, o painel do SDR e o do closer mostram o número sem alvo. Meta
 * chutada por média dos últimos meses vira o alvo oficial sem ninguém ter
 * decidido — e depois cobra-se em cima dela.
 */
export const dynamic = "force-dynamic";

export default async function MetasPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("comercial.visualizar");

  const hoje = new Date();
  const competence =
    searchParams?.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.mes)
      ? searchParams.mes
      : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const [ano, mes] = competence.split("-").map(Number);

  const [metas, agencias, sdrs, closers] = await Promise.all([
    metasDoMes(competence),
    prisma.agency.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lead.findMany({
      where: { sdr: { not: null } },
      distinct: ["sdr"],
      select: { sdr: true },
    }),
    prisma.opportunity.findMany({
      where: { closer: { not: null } },
      distinct: ["closer"],
      select: { closer: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Metas comerciais"
        description="Por mês, por pessoa e por agência — o alvo que aparece nos painéis"
        actions={<MonthNav month={mes} year={ano} />}
      />

      <PainelDeMetas
        competence={competence}
        metas={metas}
        agencias={agencias}
        pessoas={[
          ...new Set([
            ...sdrs.map((s) => s.sdr!),
            ...closers.map((c) => c.closer!),
          ]),
        ].sort()}
        podeEditar={can(viewer, "comercial.metas")}
      />
    </div>
  );
}
