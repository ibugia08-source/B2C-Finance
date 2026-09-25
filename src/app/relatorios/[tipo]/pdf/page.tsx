import { notFound, redirect } from "next/navigation";
import { periodLabel } from "@/lib/period";
import { requirePagePermission } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { getReport, canViewReport } from "@/lib/reports/registry";
import {
  parseReportQuery, parsePresentation, type SearchParams,
} from "@/lib/reports/query";
import { presentReport, formatCell } from "@/lib/reports/present";
import { planejarPagina, nomeDoArquivo, MARGEM_MM } from "@/lib/reports/print-layout";
import { WORKSPACE_TIMEZONE } from "@/lib/competence";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { Paginador } from "./paginador";

/**
 * DOCUMENTO DE EXPORTAÇÃO EM PDF (P0.1 da auditoria de 10/09/2026).
 *
 * Esta rota NÃO é a tela com @media print: é um documento próprio, e a
 * diferença é a causa raiz do achado P0 da auditoria. Os PDFs auditados eram
 * a impressão da tela do relatório, e a tela guarda a tabela dentro de um
 * contêiner com `overflow-x-auto`. No monitor isso é uma barra de rolagem; no
 * papel é conteúdo que simplesmente não existe — daí as nove tabelas com o
 * lado direito cortado e a "barra de rolagem impressa" que a auditoria
 * registrou nos PDFs 11 e 13.
 *
 * O que muda aqui, ponto a ponto contra o achado:
 *
 *  - sem casca do app, sem controle de filtro, sem rolagem em lugar nenhum;
 *  - a PÁGINA se adapta à tabela (retrato ou paisagem, decidido em
 *    print-layout a partir das colunas), e não a tabela à página;
 *  - cabeçalho de tabela repetido em toda folha e totais colados na tabela;
 *  - rodapé "página X de Y" dentro da folha, o que também elimina a página
 *    órfã que só continha rodapé (PDFs 03 e 09);
 *  - o título do documento vira o nome do arquivo no diálogo de impressão
 *    (`b2c-finance_<relatorio>_<recorte>`), como a auditoria pede.
 *
 * NESTA ETAPA O CONTEÚDO É O ATUAL, de propósito: P0.1 é integridade —
 * nenhuma coluna e nenhuma linha podem sumir. O redesenho de cada relatório
 * (resumo, gráfico adequado, metodologia) é a etapa P1.2.
 */
export const dynamic = "force-dynamic";

function dataAbsoluta(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: WORKSPACE_TIMEZONE,
  }).format(d);
}

function emissao(d: Date): string {
  const data = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: WORKSPACE_TIMEZONE,
  }).format(d);
  return `${data} (${WORKSPACE_TIMEZONE})`;
}

export default async function RelatorioPdfPage({
  params,
  searchParams,
}: {
  params: { tipo: string };
  searchParams?: SearchParams;
}) {
  const viewer = await requirePagePermission("relatorios.visualizar");
  const def = getReport(params.tipo);
  if (!def) notFound();
  // Permissão por relatório — o PDF não pode ser a porta dos fundos da tela.
  if (!canViewReport(viewer, def)) redirect("/acesso-restrito");

  await markOverdueBillings();

  const sp = searchParams ?? {};
  const query = parseReportQuery(sp);
  // O documento usa o MESMO pipeline da tela (build → present): é isso que
  // faz o PDF e a tela mostrarem os mesmos números (teste 16 da auditoria).
  // O agrupamento visual sai: no papel, subtotal de grupo entra na etapa
  // P1.2, com a especificação de cada relatório.
  const pres = parsePresentation(sp);
  const rows = await def.build(query);
  const presented = presentReport(def, rows, { ...pres, agrupar: undefined });
  const linhas = presented.groups.flatMap((g) => g.rows);
  const colunas = presented.columns;
  const plano = planejarPagina(colunas);

  const workspace = await runWithoutScope(async () => {
    const id = await currentWorkspaceId().catch(() => null);
    if (!id) return null;
    return prisma.workspace.findUnique({ where: { id }, select: { name: true } });
  }).catch(() => null);

  const fim = new Date(query.period.end.getTime() - 1);
  const recorte = `${dataAbsoluta(query.period.start)}-a-${dataAbsoluta(fim)}`;
  const titulo = nomeDoArquivo(def.title, recorte);

  // Filtros viram METADADO textual (a auditoria proíbe controle de filtro
  // impresso, mas exige saber o que foi apurado).
  const filtros: string[] = [];
  if (query.clientId) filtros.push("cliente específico");
  if (query.status) filtros.push(`status ${query.status}`);
  if (query.tipo) filtros.push(`tipo ${query.tipo}`);
  if (query.responsavel) filtros.push(`responsável "${query.responsavel}"`);
  if (query.situacao) filtros.push(`situação ${query.situacao}`);
  if (query.competencia)
    filtros.push(
      `competência ${String(query.competencia.month).padStart(2, "0")}/${query.competencia.year}`
    );
  if (query.pago != null) filtros.push(query.pago ? "somente pagos" : "somente não pagos");
  if (query.valorMin != null || query.valorMax != null) filtros.push("faixa de valor");
  if (pres.colunas?.length) filtros.push(`${colunas.length} de ${def.columns.length} colunas`);

  return (
    <>
      {/* O @page precisa ser CSS real (Tailwind não gera regra de mídia
          paginada) e a orientação é calculada — então vai inline. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@page { size: A4 ${plano.orientacao === "paisagem" ? "landscape" : "portrait"}; margin: ${MARGEM_MM}mm; }
:root { --doc-largura: ${plano.area.largura}mm; --doc-altura: ${plano.area.altura}mm; --doc-fonte: ${plano.fonteDaTabela}pt; }
html, body { background: #fff; }
.doc { width: var(--doc-largura); margin: 0 auto; color: #142B45;
  font-size: var(--doc-fonte); line-height: 1.35; }
.doc-folha { width: var(--doc-largura); box-sizing: border-box;
  display: flex; flex-direction: column; }
.doc-folha + .doc-folha { break-before: page; }
.doc-tabela { width: 100%; border-collapse: collapse; table-layout: fixed; }
.doc-tabela th, .doc-tabela td { padding: 1.4mm 1.6mm; vertical-align: top;
  border-bottom: 0.2mm solid #D7E2F2; word-break: break-word; }
/* O cabeçalho quebra ENTRE palavras, nunca dentro: "Vencimen/to" é um
   rótulo que some da leitura e do texto extraído do PDF. */
.doc-tabela thead th { word-break: normal; overflow-wrap: normal; hyphens: none;
  text-align: left; font-weight: 600; font-size: 0.92em;
  text-transform: uppercase; letter-spacing: 0.02em; color: #41556F;
  border-bottom: 0.4mm solid #73869F; }
.doc-tabela .num { text-align: right; font-variant-numeric: tabular-nums; }
.doc-tabela tfoot td { font-weight: 700; border-top: 0.4mm solid #73869F;
  border-bottom: none; }
.doc-neg { color: #B02A37; }
.doc-cabecalho { display: flex; justify-content: space-between;
  align-items: flex-start; gap: 8mm; border-bottom: 0.4mm solid #216FD3;
  padding-bottom: 2.5mm; margin-bottom: 3.5mm; }
.doc-rodape { margin-top: auto; padding-top: 2mm; border-top: 0.2mm solid #D7E2F2;
  display: flex; justify-content: space-between; font-size: 0.85em; color: #60738B; }
.doc-meta { margin-top: 3mm; padding-top: 2mm; border-top: 0.2mm solid #D7E2F2;
  font-size: 0.85em; color: #60738B; break-inside: avoid; }
.doc-aviso { margin-bottom: 3mm; padding: 2mm 2.5mm; border: 0.3mm solid #B45309;
  color: #7C4A02; font-size: 0.9em; }
@media screen {
  body { background: #EEF3FA; padding: 8mm 0; }
  .doc-folha { background: #fff; padding: ${MARGEM_MM}mm; margin: 0 auto 6mm;
    box-shadow: 0 1px 6px rgba(20,43,69,.15); width: calc(var(--doc-largura) + ${2 * MARGEM_MM}mm);
    min-height: var(--doc-altura); }
}
@media print {
  .nao-imprimir { display: none !important; }
  /* A folha é 2mm MENOR que a área útil de propósito. Igualada ao papel no
     milímetro, qualquer arredondamento do motor de impressão joga um fio de
     pixel para a página seguinte — e uma folha vira duas, a segunda quase
     vazia. Os 2mm são a folga que impede isso; o rodapé continua no pé da
     folha porque quem o empurra é o margin-top:auto, não a altura exata. */
  .doc-folha { min-height: calc(var(--doc-altura) - 2mm); }
}
`,
        }}
      />
      <title>{titulo}</title>

      <div className="doc" data-relatorio={def.key} data-orientacao={plano.orientacao}>
        <Paginador titulo={def.title} />

        {/* Folha única na renderização do servidor. O paginador recorta em
            folhas depois de MEDIR as alturas reais — sem JS, o documento
            ainda imprime certo pelo fluxo nativo (thead repete), só sem o
            "página X de Y". Degradar assim é melhor que depender de JS para
            o conteúdo existir. */}
        <section className="doc-folha" data-folha="1">
          <header className="doc-cabecalho">
            <div>
              <p style={{ fontSize: "1.55em", fontWeight: 700, lineHeight: 1.1 }}>
                {def.title}
              </p>
              <p style={{ color: "#41556F", marginTop: "1mm" }}>{def.description}</p>
              <p style={{ color: "#60738B", marginTop: "1.5mm" }}>
                Período: {dataAbsoluta(query.period.start)} a {dataAbsoluta(fim)}
                {" · "}
                {linhas.length} {linhas.length === 1 ? "registro" : "registros"}
              </p>
            </div>
            <div style={{ textAlign: "right", color: "#60738B" }}>
              <p style={{ fontWeight: 700, color: "#216FD3", fontSize: "1.1em" }}>
                {workspace?.name ?? "B2C Finance"}
              </p>
              <p>B2C Finance</p>
              <p style={{ marginTop: "1.5mm" }}>Emitido em {emissao(new Date())}</p>
            </div>
          </header>

          {plano.apertado ? (
            <p className="doc-aviso">
              Este relatório tem colunas demais para uma folha A4 mesmo em
              paisagem. Nenhuma coluna foi removida — o documento está no
              limite de legibilidade. Para leitura em papel, selecione menos
              colunas na tela antes de exportar.
            </p>
          ) : null}

          <table className="doc-tabela">
            <colgroup>
              {plano.colunas.map((c) => (
                <col key={c.key} style={{ width: `${c.percentual}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c.key}
                    className={c.kind === "money" || c.kind === "int" || c.kind === "percent" ? "num" : ""}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={colunas.length} style={{ padding: "8mm", textAlign: "center", color: "#60738B" }}>
                    Nenhum registro no recorte apurado.
                  </td>
                </tr>
              ) : null}
              {linhas.map((r, i) => (
                <tr key={i}>
                  {colunas.map((c) => {
                    const valor = r[c.key];
                    const numerico = c.kind === "money" || c.kind === "int" || c.kind === "percent";
                    const negativo = numerico && typeof valor === "number" && valor < 0;
                    return (
                      <td
                        key={c.key}
                        className={`${numerico ? "num" : ""} ${negativo ? "doc-neg" : ""}`}
                      >
                        {formatCell(valor, c.kind) || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {pres.totais && Object.keys(presented.totals).length > 0 ? (
              <tfoot>
                <tr>
                  {colunas.map((c, i) => {
                    const total = presented.totals[c.key];
                    const numerico = c.kind === "money" || c.kind === "int" || c.kind === "percent";
                    return (
                      <td key={c.key} className={numerico ? "num" : ""}>
                        {total != null
                          ? formatCell(total, c.kind)
                          : i === 0
                            ? `TOTAL (${linhas.length})`
                            : ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>

          <div className="doc-meta">
            <p>
              <strong>Como este documento foi apurado.</strong> Fonte: {def.title} do
              B2C Finance. Recorte: {dataAbsoluta(query.period.start)} a{" "}
              {dataAbsoluta(fim)} ({periodLabel(query.period)}). Filtros:{" "}
              {filtros.length ? filtros.join("; ") : "nenhum além do período"}.
              Ordenação: {pres.ordenar ?? def.defaultSort.key} (
              {(pres.ordenar ? pres.dir : def.defaultSort.dir) === "asc" ? "crescente" : "decrescente"}).
              Fuso: {WORKSPACE_TIMEZONE}.
            </p>
          </div>

          <footer className="doc-rodape">
            <span>
              {def.title} · {dataAbsoluta(query.period.start)} a {dataAbsoluta(fim)}
            </span>
            <span data-pagina>B2C Finance · Um produto B2C Gestão</span>
          </footer>
        </section>
      </div>
    </>
  );
}
