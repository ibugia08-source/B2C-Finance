"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { mesAtual, mesDaUrl, shiftMes } from "@/lib/month-param";
import { visibleCommands } from "@/lib/commands";
import { irParaMes, openPalette } from "./command-palette";
import { requestUndo } from "./undo-toast";
import type { UserLike } from "./nav-items";

/**
 * ATALHOS GLOBAIS (F1.14 · ref. 02 §3): g m · g c · g r · [ · ] · / · ?
 * mais Ctrl/Cmd+K.
 *
 * Duas regras que evitam os bugs clássicos de atalho:
 *  1. Nada dispara enquanto o foco está em campo de texto ou em algo
 *     editável — senão digitar "gc" numa observação teleportaria o
 *     usuário para a Carteira no meio da frase.
 *  2. O prefixo `g` espera a segunda tecla por 1,2s e depois desiste,
 *     em vez de ficar armado para sempre.
 *
 * O destino de cada atalho vem do REGISTRO de comandos, não de rotas
 * escritas aqui: se o usuário não tem permissão para a tela, o atalho
 * simplesmente não existe para ele.
 */
export function GlobalShortcuts({ user }: { user: UserLike }) {
  const router = useRouter();
  const prefixo = useRef<{ tecla: string; em: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    const comandos = visibleCommands(user);
    const porAtalho = new Map(comandos.filter((c) => c.shortcut).map((c) => [c.shortcut!, c]));

    function editando(alvo: EventTarget | null): boolean {
      const el = alvo as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable === true
      );
    }

    function onKey(e: KeyboardEvent) {
      // Ctrl/Cmd+K funciona MESMO dentro de campo: é o jeito de sair dele.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette("all");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (editando(e.target)) return;

      // Segunda tecla de uma sequência iniciada por `g`.
      const pendente = prefixo.current;
      if (pendente && Date.now() - pendente.em < 1200) {
        prefixo.current = null;
        const cmd = porAtalho.get(`${pendente.tecla} ${e.key.toLowerCase()}`);
        if (cmd?.href) {
          e.preventDefault();
          router.push(cmd.href);
          return;
        }
      }
      prefixo.current = null;

      switch (e.key) {
        case "g":
          prefixo.current = { tecla: "g", em: Date.now() };
          return;
        case "/":
          e.preventDefault();
          openPalette("search");
          return;
        case "?":
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("b2c:shortcuts"));
          return;
        case "[":
          e.preventDefault();
          irParaMes(router, shiftMes(mesDaUrl(window.location.search), -1));
          return;
        case "]":
          e.preventDefault();
          irParaMes(router, shiftMes(mesDaUrl(window.location.search), 1));
          return;
        case "t":
          // "t" leva ao mês atual — atalho de conveniência do MonthNav.
          e.preventDefault();
          irParaMes(router, mesAtual());
          return;
        case "u":
          // 02 §3 e cenário S24: "u desfaz". Vale em qualquer tela — quem
          // acabou de registrar um pagamento errado não vai procurar o botão
          // do toast com o mouse. Sem toast aberto, não faz nada.
          e.preventDefault();
          requestUndo();
          return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, router]);

  return null;
}
