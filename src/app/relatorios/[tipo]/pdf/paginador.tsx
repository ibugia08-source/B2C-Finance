"use client";
import { useEffect, useState } from "react";

/**
 * PAGINADOR DO DOCUMENTO (P0.1 da auditoria).
 *
 * O HTML não sabe numerar página: `@page` do CSS paginado tem caixas de
 * margem com `counter(page)` na especificação, e o motor de impressão do
 * Chrome — que é onde estes PDFs nascem — não as implementa. O navegador põe
 * o número dele no cabeçalho do papel, junto com a URL e a data, que é
 * exatamente o que a auditoria manda tirar.
 *
 * Então a paginação é NOSSA: o componente mede as alturas reais depois do
 * render e recorta a tabela em folhas A4, cada uma com o cabeçalho repetido e
 * o rodapé "página X de Y". Três garantias que vêm disso, e que o fluxo
 * nativo não dá:
 *
 *  1. CABEÇALHO REPETIDO de verdade, incluindo o do documento (o `thead`
 *     nativo repete a tabela, mas não diz de que relatório e período é a
 *     folha 7 que alguém arrancou da pilha);
 *  2. NENHUMA FOLHA SÓ COM RODAPÉ — a auditoria achou duas (PDFs 03 e 09).
 *     A última folha exige um mínimo de linhas; se não couber, o corte sobe
 *     e puxa linhas da folha anterior;
 *  3. o total fica colado na tabela, na mesma folha das últimas linhas.
 *
 * SEM JAVASCRIPT o documento continua correto: o servidor já rende a tabela
 * inteira em fluxo único e o `thead` repete sozinho. Perde-se a numeração,
 * não o conteúdo — degradar assim é a diferença entre um documento pior e um
 * documento faltando dados.
 */

/** Nenhuma folha final com menos que isto: rodapé órfão é achado da auditoria. */
const MIN_LINHAS_NA_ULTIMA = 3;
const PX_POR_MM = 96 / 25.4;

export function Paginador({ titulo }: { titulo: string }) {
  const [estado, setEstado] = useState<"medindo" | "pronto" | "sem-suporte">("medindo");

  useEffect(() => {
    // O efeito roda DUAS VEZES no modo estrito do React em desenvolvimento.
    // Sem esta trava, a segunda execução pega a primeira folha já recortada
    // como se fosse o documento inteiro e a re-pagina: o rodapé da folha 1
    // vira "página 1 de 1" no meio de um documento de seis. A trava é o
    // próprio atributo que o script de verificação lê — uma marca só.
    if (document.documentElement.dataset.paginado) return setEstado("pronto");

    const doc = document.querySelector<HTMLElement>(".doc");
    const origem = doc?.querySelector<HTMLElement>('.doc-folha[data-folha="1"]');
    if (!doc || !origem) return setEstado("sem-suporte");

    const alturaMm = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--doc-altura")
    );
    if (!Number.isFinite(alturaMm) || alturaMm <= 0) return setEstado("sem-suporte");
    const alturaPagina = alturaMm * PX_POR_MM;

    const cabecalho = origem.querySelector<HTMLElement>(".doc-cabecalho");
    const aviso = origem.querySelector<HTMLElement>(".doc-aviso");
    const tabela = origem.querySelector<HTMLTableElement>(".doc-tabela");
    const meta = origem.querySelector<HTMLElement>(".doc-meta");
    const rodape = origem.querySelector<HTMLElement>(".doc-rodape");
    if (!cabecalho || !tabela || !rodape) return setEstado("sem-suporte");

    const corpo = tabela.tBodies[0];
    const linhas = Array.from(corpo?.rows ?? []);
    // Uma folha só já resolve: não vale recortar o que não precisa.
    if (linhas.length === 0) {
      document.documentElement.dataset.paginado = "1";
      return setEstado("pronto");
    }

    // offsetHeight IGNORA MARGEM, e é margem que estoura folha: o cabeçalho
    // tem 3,5mm embaixo e a metodologia 3mm em cima. Medir sem elas fazia a
    // folha passar do papel e o Chrome quebrar de novo — duas páginas físicas
    // para uma folha nossa, com a segunda quase vazia.
    const alturaDe = (el: Element | null) => {
      if (!el) return 0;
      const e = el as HTMLElement;
      const cs = getComputedStyle(e);
      return e.getBoundingClientRect().height +
        parseFloat(cs.marginTop || "0") + parseFloat(cs.marginBottom || "0");
    };
    const hCabecalho = alturaDe(cabecalho) + alturaDe(aviso);
    const hRodape = alturaDe(rodape);
    const hThead = alturaDe(tabela.tHead);
    const hTfoot = alturaDe(tabela.tFoot);
    const hMeta = alturaDe(meta);
    const alturaDasLinhas = linhas.map((l) => l.getBoundingClientRect().height);
    /** Folga de arredondamento: 1px de sobra vira página inteira no Chrome. */
    const FOLGA = 6;

    // Espaço para linhas em uma folha comum e na última (que carrega o
    // total e a metodologia junto).
    const disponivelComum = alturaPagina - hCabecalho - hRodape - hThead - FOLGA;
    const disponivelUltima = disponivelComum - hTfoot - hMeta;
    if (disponivelComum <= 0) return setEstado("sem-suporte");

    // 1. corte ganancioso, com a última folha cabendo total + metodologia.
    const cortes: number[][] = [];
    let atual: number[] = [];
    let usado = 0;
    for (let i = 0; i < linhas.length; i++) {
      const h = alturaDasLinhas[i];
      const ehUltima = i === linhas.length - 1;
      const teto = ehUltima ? disponivelUltima : disponivelComum;
      if (atual.length > 0 && usado + h > teto) {
        cortes.push(atual);
        atual = [];
        usado = 0;
      }
      atual.push(i);
      usado += h;
    }
    if (atual.length > 0) cortes.push(atual);

    // 2. última folha magra demais: puxa linhas da anterior até o mínimo.
    //    É isto que impede a "página praticamente só com o rodapé".
    if (cortes.length > 1) {
      const ultima = cortes[cortes.length - 1];
      const penultima = cortes[cortes.length - 2];
      while (ultima.length < MIN_LINHAS_NA_ULTIMA && penultima.length > 1) {
        ultima.unshift(penultima.pop()!);
      }
    }

    // 3. monta as folhas.
    const molde = origem.cloneNode(true) as HTMLElement;
    const novas: HTMLElement[] = [];
    cortes.forEach((indices, i) => {
      const folha = molde.cloneNode(true) as HTMLElement;
      folha.dataset.folha = String(i + 1);
      const t = folha.querySelector<HTMLTableElement>(".doc-tabela")!;
      const tb = t.tBodies[0];
      while (tb.rows.length) tb.deleteRow(0);
      for (const idx of indices) tb.appendChild(linhas[idx].cloneNode(true));
      // Total e metodologia só na última; cabeçalho em todas.
      const ehUltima = i === cortes.length - 1;
      if (!ehUltima) {
        t.tFoot?.remove();
        folha.querySelector(".doc-meta")?.remove();
      }
      folha.querySelector(".doc-aviso")?.remove();
      if (i === 0 && aviso) folha.querySelector(".doc-tabela")?.before(aviso.cloneNode(true));
      const marcador = folha.querySelector<HTMLElement>("[data-pagina]");
      if (marcador)
        marcador.textContent = `B2C Finance · página ${i + 1} de ${cortes.length}`;
      novas.push(folha);
    });

    origem.replaceWith(...novas);
    document.documentElement.dataset.paginado = String(cortes.length);
    setEstado("pronto");
  }, []);

  return (
    <div
      className="nao-imprimir"
      style={{
        display: "flex", gap: "8px", alignItems: "center", justifyContent: "center",
        margin: "0 auto 6mm", fontSize: "11px", color: "#41556F",
      }}
    >
      <button
        type="button"
        onClick={() => window.print()}
        style={{
          border: "1px solid #216FD3", background: "#216FD3", color: "#fff",
          borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600,
        }}
      >
        Salvar em PDF
      </button>
      <span>
        {estado === "pronto"
          ? `${titulo} pronto para impressão. No diálogo, desmarque "Cabeçalhos e rodapés" — a numeração já está no documento.`
          : estado === "sem-suporte"
            ? "Documento em fluxo contínuo (sem numeração própria)."
            : "Medindo a paginação…"}
      </span>
    </div>
  );
}
