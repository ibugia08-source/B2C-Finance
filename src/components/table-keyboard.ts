"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * NAVEGAÇÃO DE TABELA POR TECLADO (F3.12 · ref. 02 §3, §7.7, §7.9).
 *
 * "Tabelas: setas navegam, Enter abre, espaço seleciona, p registra pagamento
 * na linha, u desfaz."
 *
 * Hook compartilhado, e não um trecho copiado em cada tabela, porque as
 * armadilhas são sempre as mesmas três e errar uma quebra a tela inteira:
 *
 *  1. NÃO SEQUESTRAR O QUE ESTÁ SENDO DIGITADO. A tabela tem select, input de
 *     valor e campo de observação dentro das linhas. Sem esta guarda,
 *     escrever "pagamento parcial" numa observação registraria um pagamento
 *     na letra "p".
 *  2. FOCO ROTATIVO (roving tabindex), não um tabIndex em cada linha. Com
 *     todas as linhas focáveis, um Tab atravessa cinquenta paradas antes de
 *     chegar no rodapé — o oposto de acessível.
 *  3. ESPAÇO SELECIONA, e por isso precisa de preventDefault: a tecla rola a
 *     página por padrão, e a linha selecionada sairia da tela no gesto.
 */

export type TeclasDaTabela = {
  /** Enter: abrir o item. */
  onAbrir?: (indice: number) => void;
  /** Espaço: selecionar. */
  onSelecionar?: (indice: number) => void;
  /** Teclas próprias da tela — ex.: `{ p: (i) => registrarPagamento(i) }`. */
  extras?: Record<string, (indice: number) => void>;
};

export function useTableKeyboard(total: number, acoes: TeclasDaTabela) {
  const [foco, setFoco] = useState(0);
  const container = useRef<HTMLDivElement | null>(null);

  // O índice tem de sobreviver à lista encolhendo (filtro, item resolvido).
  useEffect(() => {
    setFoco((f) => Math.max(0, Math.min(f, total - 1)));
  }, [total]);

  const focar = useCallback((i: number) => {
    const alvo = container.current?.querySelector<HTMLElement>(`[data-linha="${i}"]`);
    alvo?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey || total === 0) return;

      const mover = (delta: number) => {
        e.preventDefault();
        setFoco((f) => {
          const novo = Math.max(0, Math.min(total - 1, f + delta));
          focar(novo);
          return novo;
        });
      };

      switch (e.key) {
        case "ArrowDown": mover(1); return;
        case "ArrowUp": mover(-1); return;
        case "Home": e.preventDefault(); setFoco(0); focar(0); return;
        case "End": e.preventDefault(); setFoco(total - 1); focar(total - 1); return;
        case "Enter":
          if (acoes.onAbrir) { e.preventDefault(); acoes.onAbrir(foco); }
          return;
        case " ":
          if (acoes.onSelecionar) { e.preventDefault(); acoes.onSelecionar(foco); }
          return;
        default: {
          const acao = acoes.extras?.[e.key.toLowerCase()];
          if (acao) { e.preventDefault(); acao(foco); }
        }
      }
    },
    [total, foco, focar, acoes]
  );

  /** Props da LINHA: só a focada é alcançável por Tab (roving tabindex). */
  const linhaProps = useCallback(
    (i: number) => ({
      "data-linha": i,
      tabIndex: i === foco ? 0 : -1,
      onFocus: () => setFoco(i),
    }),
    [foco]
  );

  return { container, onKeyDown, linhaProps, foco };
}
