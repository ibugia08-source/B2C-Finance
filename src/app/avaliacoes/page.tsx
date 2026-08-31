import { PageHeader } from "@/components/page-header";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { competenceLabel, isCompetence, toCompetence, type Competence } from "@/lib/competence";
import { mesAtual, parseMes } from "@/lib/month-param";
import { carregarGrade } from "@/lib/services/avaliacao-mensal";
import { GradeAvaliacao } from "./grade";

/**
 * AVALIAÇÃO MENSAL (F1.17 · ref. 01 §4.13, 02 §4.1).
 *
 * Uma linha por cliente ativo, quatro colunas de leitura do gestor mais a
 * observação. A competência vem do ?mes= da barra global — a mesma de
 * todas as telas por competência.
 */
export const dynamic = "force-dynamic";

export default async function AvaliacoesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  const viewer = await requirePagePermission("clientes.visualizar", "/avaliacoes");
  const mes = parseMes(searchParams?.mes) ?? mesAtual();
  const competence = toCompetence(mes.year, mes.month);
  const linhas = isCompetence(competence) ? await carregarGrade(competence as Competence) : [];

  return (
    <div>
      <PageHeader
        title="Avaliação mensal"
        description={`Leitura da carteira em ${competenceLabel(competence as Competence)} — a linha já vem preenchida com o mês anterior; corrija só o que mudou.`}
      />
      <GradeAvaliacao
        competence={competence}
        linhas={linhas}
        podeEditar={can(viewer, "clientes.editar")}
      />
    </div>
  );
}
