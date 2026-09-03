import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/viewer";
import { lerFotografia } from "@/lib/snapshots/read";
import { formatBRL, formatPercent, monthLabel } from "@/lib/format";
import { METRIC_REGISTRY } from "@/lib/metrics/registry";
import { BotaoImprimir } from "./imprimir";
import "./documento.css";

/**
 * TEMA DOCUMENTO (F2.10 · ref. 02 §7.8).
 *
 * "Capa navy #0d1b2e com grão, quadrados sobrepostos, marca d'água B2C,
 * título condensado, dourado #F5C518 só nos valores de destaque da capa;
 * miolo claro no gabarito Documento; cabeçalho com competência e escopo;
 * rodapé com página, versão do snapshot e checksum; zebra 3%."
 *
 * O PDF sai pela impressão do navegador, e é decisão: gerar PDF no servidor
 * exigiria um Chrome headless em produção — uns 300 MB de imagem e uma classe
 * inteira de falha nova (fonte que não carrega, processo que não morre) para
 * produzir o mesmo arquivo que o navegador já produz. A regra de layout mora
 * em CSS de impressão, que é conferível abrindo a página.
 *
 * O RODAPÉ COM CHECKSUM é o que faz este documento valer como prova: dois
 * PDFs do mesmo mês com checksums diferentes são dois fechamentos diferentes,
 * e dá para saber qual é qual sem abrir o sistema.
 */
export const dynamic = "force-dynamic";

export default async function DocumentoPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  await requirePagePermission("fechamento.fechar");

  const mesParam = searchParams?.mes;
  if (!mesParam || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesParam)) notFound();
  const foto = await lerFotografia(mesParam);
  if (!foto) notFound();

  const [ano, mes] = foto.competence.split("-").map(Number);
  const titulo = monthLabel(new Date(ano, mes - 1, 1));
  const indicadores = (foto.areas.indicadores ?? {}) as Record<string, any>;

  const destaque = ["faturamento_total", "recebido_competencia", "resultado_mes"]
    .map((k) => ({ chave: k, def: METRIC_REGISTRY.find((m) => m.key === k), v: indicadores[k] }))
    .filter((d) => d.v?.valor != null);

  const carteira = Array.isArray(foto.areas.carteira) ? foto.areas.carteira : [];
  const receber = foto.areas.receber?.cobrancas ?? [];
  const aging = foto.areas.receber?.aging ?? {};

  return (
    <div className="doc">
      <BotaoImprimir />

      {/* ===== CAPA ===== */}
      <section className="doc-capa">
        <div className="doc-capa-grao" aria-hidden />
        <div className="doc-capa-quadrados" aria-hidden>
          <span /><span /><span />
        </div>
        <div className="doc-capa-marca" aria-hidden>B2C</div>

        <div className="doc-capa-conteudo">
          <p className="doc-capa-eyebrow">Fotografia do fechamento</p>
          <h1 className="doc-capa-titulo">{titulo}</h1>
          <p className="doc-capa-sub">
            versão {foto.versao}
            {foto.fechadoPor ? ` · fechado por ${foto.fechadoPor}` : ""}
            {` · ${foto.fechadoEm.toLocaleDateString("pt-BR")}`}
          </p>

          <dl className="doc-capa-destaques">
            {destaque.map((d) => (
              <div key={d.chave}>
                <dt>{d.def?.name ?? d.chave}</dt>
                <dd>{formatBRL(d.v.valor)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ===== MIOLO ===== */}
      <section className="doc-miolo">
        <header className="doc-cabecalho">
          <span>{titulo}</span>
          <span>B2C Gestão · todas as agências</span>
        </header>

        <h2>Indicadores no fechamento</h2>
        <table className="doc-tabela">
          <thead>
            <tr>
              <th>Indicador</th>
              <th className="num">Valor</th>
              <th>Base</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(indicadores).map(([chave, v]: [string, any]) => {
              const def = METRIC_REGISTRY.find((m) => m.key === chave);
              return (
                <tr key={chave}>
                  <td>{def?.name ?? chave}</td>
                  <td className="num">
                    {v?.valor == null
                      ? "—"
                      : def?.rounding?.includes("%")
                        ? formatPercent(v.valor)
                        : def?.rounding?.includes("half-up, 2 casas")
                          ? formatBRL(v.valor)
                          : String(v.valor)}
                  </td>
                  <td>{v?.base ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>A receber no fechamento</h2>
        <table className="doc-tabela">
          <thead>
            <tr>
              <th>Faixa de atraso</th>
              <th className="num">Cobranças</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(aging as Record<string, any>).map(([faixa, v]) => (
              <tr key={faixa}>
                <td>{faixa === "60+" ? "mais de 60 dias" : `${faixa} dias`}</td>
                <td className="num">{v.qtd}</td>
                <td className="num">{formatBRL(Number(v.valor))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="doc-nota">
          {receber.length} cobranças da competência · {carteira.length} clientes
          na carteira no momento do fechamento.
        </p>

        <h2>Como este documento foi gerado</h2>
        <table className="doc-tabela">
          <tbody>
            <tr>
              <td>Formato da fotografia</td>
              <td className="num">v{foto.schemaVersion}</td>
            </tr>
            <tr>
              <td>Dicionário de métricas</td>
              <td className="num">v{foto.metricVersion}</td>
            </tr>
            <tr>
              <td>Fatos lidos até</td>
              <td className="num">{foto.sourceCutoffAt.toLocaleString("pt-BR")}</td>
            </tr>
            <tr>
              <td>Assinatura</td>
              <td className="num doc-mono">{foto.checksum}</td>
            </tr>
          </tbody>
        </table>

        {/* O DRE entra aqui quando a F3.2 existir — declarado em vez de
            deixar um espaço em branco que pareceria dado faltando. */}
        <h2>Resultado gerencial</h2>
        <p className="doc-nota">
          O DRE por competência entra neste documento quando a Fase 3 (F3.2)
          existir. Até lá, o resultado do mês está entre os indicadores acima.
        </p>
      </section>

      <footer className="doc-rodape">
        <span>
          {titulo} · fotografia v{foto.versao}
        </span>
        <span className="doc-mono">{foto.checksum.slice(0, 24)}</span>
      </footer>
    </div>
  );
}
