import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { NAV_AREAS } from "@/components/nav-items";
import { ROTAS_APOSENTADAS } from "../next.config.mjs";

/**
 * UX-01 — destino operacional em 404.
 *
 * A auditoria de 11/09/2026 clicou em dois links reais do produto e caiu em
 * "Página não encontrada": `/caixa`, oferecido pela rotina da semana, e
 * `/fila`, gravado numa notificação antiga.
 *
 * O segundo caso é o que ensina a regra: link de notificação, de e-mail e de
 * rotina NÃO é código — ele fica gravado no banco e sobrevive a qualquer
 * renomeação de rota. Por isso rota aposentada ganha redirecionamento em vez
 * de simplesmente sumir.
 *
 * Este teste percorre o app e confere que todo destino prometido existe: os
 * do menu, os que os serviços montam em código e os destinos da tabela de
 * rotas aposentadas.
 */

/** Rotas que o App Router serve, derivadas das pastas com page.tsx. */
function rotasDoApp(): Set<string> {
  const out = new Set<string>();
  (function anda(dir: string, rota: string) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (!statSync(p).isDirectory()) {
        if (nome === "page.tsx") out.add(rota === "" ? "/" : rota);
        continue;
      }
      // (grupos) não entram na URL; [params] viram curinga.
      if (nome.startsWith("(") && nome.endsWith(")")) anda(p, rota);
      else if (nome.startsWith("[")) anda(p, `${rota}/:param`);
      else anda(p, `${rota}/${nome}`);
    }
  })("src/app", "");
  return out;
}

const ROTAS = rotasDoApp();

/** O destino existe? Um segmento dinâmico casa com qualquer valor. */
function existe(href: string): boolean {
  const caminho = href.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
  if (ROTAS.has(caminho)) return true;
  const partes = caminho.split("/");
  for (const rota of ROTAS) {
    const p = rota.split("/");
    if (p.length !== partes.length) continue;
    if (p.every((seg, i) => seg === ":param" || seg === partes[i])) return true;
  }
  return false;
}

describe("todo destino prometido pela navegação existe", () => {
  it("as páginas do menu", () => {
    const quebradas = NAV_AREAS.flatMap((a) => a.pages)
      .filter((p) => !existe(p.href))
      .map((p) => `${p.label} → ${p.href}`);
    expect(quebradas).toEqual([]);
  });

  it("/caixa existe — era o link da rotina da semana que dava 404", () => {
    expect(existe("/caixa")).toBe(true);
  });
});

describe("rotas aposentadas redirecionam em vez de dar 404", () => {
  it("toda origem aposentada tem destino que existe", () => {
    const quebradas = ROTAS_APOSENTADAS.filter(
      (r) => !existe(r.destino)
    ).map((r) => `${r.origem} → ${r.destino}`);
    expect(quebradas).toEqual([]);
  });

  it("/fila continua atendido — a notificação antiga que a auditoria abriu", () => {
    const regra = ROTAS_APOSENTADAS.find((r) => r.origem === "/fila");
    expect(regra).toBeTruthy();
    expect(existe(regra!.destino)).toBe(true);
  });

  it("nenhuma origem aposentada colide com uma página viva", () => {
    // Se a rota voltar a existir, o redirecionamento passa a sequestrá-la.
    const colisoes = ROTAS_APOSENTADAS.filter(
      (r) => !r.origem.includes(":") && ROTAS.has(r.origem)
    ).map((r) => r.origem);
    expect(colisoes).toEqual([]);
  });
});

describe("hrefs montados em código apontam para páginas reais", () => {
  const ARQUIVOS = [
    "src/lib/services/weekly-routine.ts",
    "src/lib/services/notifications.ts",
  ];

  it.each(ARQUIVOS)("%s", (arquivo) => {
    const fonte = readFileSync(arquivo, "utf8");
    // Só os literais: href: "/x" e link: "/x".
    const achados = [...fonte.matchAll(/(?:href|link):\s*"(\/[^"]*)"/g)].map((m) => m[1]);
    expect(achados.length).toBeGreaterThan(0);
    const quebrados = achados.filter((h) => !existe(h));
    expect(quebrados).toEqual([]);
  });
});
