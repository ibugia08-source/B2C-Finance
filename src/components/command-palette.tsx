"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, CornerDownLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterCommands, visibleCommands, type Command } from "@/lib/commands";
import { clientSearchIndex, globalSearch, type SearchGroup, type SearchHit } from "@/lib/search";
import { formatMes, mesAtual, mesDaUrl, shiftMes, MES_PARAM } from "@/lib/month-param";
import { toggleTheme } from "@/lib/theme";
import type { UserLike } from "./nav-items";

/**
 * PALETA DE COMANDOS E BUSCA GLOBAL (F1.14 · ref. 02 §3).
 *
 * Ctrl/Cmd+K abre tudo; "/" abre já em modo busca. A spec é explícita
 * em que a paleta é "acelerador, nunca caminho único" — por isso todo
 * comando daqui também existe como link ou botão em alguma tela.
 *
 * Carteira é índice LOCAL: a lista de clientes é baixada uma vez e
 * filtrada no navegador, o que faz o resultado aparecer sem espera. O
 * resto (cobranças, contratos, despesas) vai ao servidor com atraso de
 * 180ms para não disparar uma consulta por tecla.
 */

const EVENTO = "b2c:palette";

/** Abre a paleta de qualquer lugar, sem context nem prop drilling. */
export function openPalette(mode: "all" | "search" = "all") {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { mode } }));
}

type Row =
  | { tipo: "comando"; cmd: Command }
  | { tipo: "achado"; hit: SearchHit };

type Secao = { titulo: string; linhas: Row[] };

type ClienteIdx = { id: string; name: string; document: string | null; status: string };

export function CommandPalette({ user }: { user: UserLike }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [grupos, setGrupos] = useState<SearchGroup[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [carteira, setCarteira] = useState<ClienteIdx[] | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const comandos = useMemo(() => visibleCommands(user), [user]);

  // ---- abertura por evento global -------------------------------------
  useEffect(() => {
    function onAbrir() {
      setQ("");
      setAtivo(0);
      setGrupos([]);
      setAberta(true);
    }
    window.addEventListener(EVENTO, onAbrir as EventListener);
    return () => window.removeEventListener(EVENTO, onAbrir as EventListener);
  }, []);

  // ---- índice local da carteira: uma vez, na primeira abertura --------
  useEffect(() => {
    if (!aberta || carteira !== null) return;
    let vivo = true;
    clientSearchIndex()
      .then((r) => vivo && setCarteira(r))
      .catch(() => vivo && setCarteira([]));
    return () => {
      vivo = false;
    };
  }, [aberta, carteira]);

  // ---- busca no servidor, com atraso ---------------------------------
  useEffect(() => {
    if (!aberta) return;
    const termo = q.trim();
    if (termo.length < 2) {
      setGrupos([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      globalSearch(termo)
        .then((g) => setGrupos(g.filter((x) => x.kind !== "cliente")))
        .catch(() => setGrupos([]))
        .finally(() => setBuscando(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, aberta]);

  // ---- montagem das seções -------------------------------------------
  const secoes: Secao[] = useMemo(() => {
    const termo = q.trim();
    const out: Secao[] = [];

    if (termo) {
      // Carteira primeiro: é a busca instantânea e a mais usada.
      const alvo = termo.toLowerCase();
      const clientes = (carteira ?? [])
        .filter(
          (c) =>
            c.name.toLowerCase().includes(alvo) ||
            (c.document ?? "").toLowerCase().includes(alvo)
        )
        .slice(0, 6);
      if (clientes.length) {
        out.push({
          titulo: "Clientes",
          linhas: clientes.map((c) => ({
            tipo: "achado" as const,
            hit: {
              id: c.id,
              kind: "cliente" as const,
              title: c.name,
              subtitle: c.status === "ACTIVE" ? "ativo" : c.status.toLowerCase(),
              href: `/clientes/${c.id}`,
            },
          })),
        });
      }
    }

    const cmds = filterCommands(comandos, termo);
    for (const grupo of ["Ações", "Período", "Ir para", "Exibição"] as const) {
      const doGrupo = cmds.filter((c) => c.group === grupo);
      if (doGrupo.length) {
        out.push({
          titulo: grupo,
          linhas: doGrupo.map((cmd) => ({ tipo: "comando" as const, cmd })),
        });
      }
    }

    for (const g of grupos) {
      out.push({
        titulo: g.label,
        linhas: g.hits.map((hit) => ({ tipo: "achado" as const, hit })),
      });
    }
    return out;
  }, [q, comandos, grupos, carteira]);

  const linhas = useMemo(() => secoes.flatMap((s) => s.linhas), [secoes]);

  useEffect(() => {
    setAtivo(0);
  }, [q]);

  // ---- execução -------------------------------------------------------
  const executar = useCallback(
    (row: Row) => {
      setAberta(false);
      if (row.tipo === "achado") {
        router.push(row.hit.href);
        return;
      }
      const { cmd } = row;
      if (cmd.href) {
        router.push(cmd.href);
        return;
      }
      switch (cmd.action) {
        case "mesAnterior":
        case "mesSeguinte": {
          const base = mesDaUrl(window.location.search);
          irParaMes(router, shiftMes(base, cmd.action === "mesAnterior" ? -1 : 1));
          break;
        }
        case "mesAtual":
          irParaMes(router, mesAtual());
          break;
        case "alternarTema":
          toggleTheme();
          break;
        case "mapaDeAtalhos":
          window.dispatchEvent(new CustomEvent("b2c:shortcuts"));
          break;
      }
    },
    [router]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((i) => (linhas.length ? (i + 1) % linhas.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => (linhas.length ? (i - 1 + linhas.length) % linhas.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = linhas[ativo];
      if (row) executar(row);
    }
  }

  // Mantém a linha ativa visível ao navegar por teclado.
  useEffect(() => {
    const el = listaRef.current?.querySelector<HTMLElement>(`[data-idx="${ativo}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  if (!user) return null;

  let idx = -1;

  return (
    <DialogPrimitive.Root open={aberta} onOpenChange={setAberta}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-modal border bg-popover elev-3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            Busca e comandos
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Digite para buscar clientes, cobranças, contratos e despesas, ou escolher uma ação.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cliente, cobrança, contrato… ou digitar um comando"
              aria-label="Buscar ou executar comando"
              role="combobox"
              aria-expanded
              aria-controls="paleta-lista"
              aria-activedescendant={linhas.length ? `paleta-item-${ativo}` : undefined}
              className="h-12 w-full bg-transparent text-emphasis outline-none placeholder:text-muted-foreground"
            />
            {buscando && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
          </div>

          <div
            ref={listaRef}
            id="paleta-lista"
            role="listbox"
            aria-label="Resultados"
            className="max-h-[52vh] overflow-y-auto py-2"
          >
            {linhas.length === 0 ? (
              <p className="px-4 py-8 text-center text-body text-muted-foreground">
                {q.trim()
                  ? "Nada encontrado. Tente outro termo."
                  : "Comece a digitar para buscar."}
              </p>
            ) : (
              secoes.map((s) => (
                <div key={s.titulo} className="px-2 pb-1">
                  <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {s.titulo}
                  </p>
                  {s.linhas.map((row) => {
                    idx += 1;
                    const i = idx;
                    const selecionado = i === ativo;
                    return (
                      <button
                        key={row.tipo === "comando" ? row.cmd.id : `${row.hit.kind}-${row.hit.id}`}
                        id={`paleta-item-${i}`}
                        data-idx={i}
                        role="option"
                        aria-selected={selecionado}
                        type="button"
                        onMouseMove={() => setAtivo(i)}
                        onClick={() => executar(row)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-cell px-2 py-2 text-left text-body transition-colors duration-instant",
                          selecionado ? "bg-accent text-accent-foreground" : "text-foreground"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {row.tipo === "comando" ? row.cmd.label : row.hit.title}
                          {(row.tipo === "comando" ? row.cmd.hint : row.hit.subtitle) && (
                            <span className="ml-2 text-caption text-muted-foreground">
                              {row.tipo === "comando" ? row.cmd.hint : row.hit.subtitle}
                            </span>
                          )}
                        </span>
                        {row.tipo === "comando" && row.cmd.shortcut && (
                          <Kbd>{row.cmd.shortcut}</Kbd>
                        )}
                        {selecionado && (
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navegar</span>
            <span><Kbd>↵</Kbd> abrir</span>
            <span><Kbd>esc</Kbd> fechar</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-border-soft bg-surface-soft px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

/** Navega preservando os demais filtros da URL — só o mês muda. */
export function irParaMes(router: ReturnType<typeof useRouter>, mes: { year: number; month: number }) {
  const params = new URLSearchParams(window.location.search);
  params.set(MES_PARAM, formatMes(mes));
  router.push(`${window.location.pathname}?${params.toString()}`);
}
