import { PageHeader } from "@/components/page-header";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { painelDoSdr } from "@/lib/services/sdr-activity";
import { ContadorDeAtividade } from "./contador";

/**
 * ATIVIDADE DO DIA (F4.3 · ref. 02 §5.4; cenário S2).
 *
 * "Atividade registrada em 30 segundos, com meta visível."
 *
 * A tela é MOBILE PRIMEIRO de verdade, não responsiva por acidente: o SDR
 * registra entre uma ligação e outra, em pé, com uma mão. Botões grandes,
 * um toque por campo, nada de salvar.
 *
 * A meta aparece ao lado do número desde o primeiro toque — meta escondida
 * atrás de um clique é meta que ninguém vê.
 */
export const dynamic = "force-dynamic";

export default async function AtividadePage({
  searchParams,
}: {
  searchParams?: { sdr?: string };
}) {
  const viewer = await requirePagePermission("comercial.visualizar");

  // De quem é a atividade: por padrão, de quem está logado. A troca existe
  // para o gestor lançar por alguém que ficou sem sinal — e ela é explícita.
  const conhecidos = await prisma.atividadeDiaria.findMany({
    distinct: ["sdr"],
    orderBy: { sdr: "asc" },
    select: { sdr: true },
  });
  const doFunil = await prisma.lead.findMany({
    where: { sdr: { not: null } },
    distinct: ["sdr"],
    select: { sdr: true },
  });
  const nomes = [
    ...new Set(
      [
        viewer.name,
        ...conhecidos.map((c) => c.sdr),
        ...doFunil.map((l) => l.sdr!),
      ].filter((x): x is string => !!x && x.trim().length > 0)
    ),
  ].sort();

  const sdr = searchParams?.sdr && nomes.includes(searchParams.sdr)
    ? searchParams.sdr
    : (viewer.name ?? nomes[0] ?? "Sem nome");

  const painel = await painelDoSdr(sdr);

  return (
    <div>
      <PageHeader
        title="Atividade do dia"
        description={`${painel.diasUteisDecorridos} de ${painel.diasUteisNoMes} dias úteis do mês`}
      />

      <ContadorDeAtividade
        painel={{
          ...painel,
          data: painel.data.toISOString(),
        }}
        nomes={nomes}
        podeRegistrar={can(viewer, "comercial.operar")}
      />
    </div>
  );
}
