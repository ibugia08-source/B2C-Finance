/**
 * AUDITORIA AA MECÂNICA (T5 · cenário S26; 02 §245).
 *
 *   node scripts/auditoria-aa.mjs        → relatório
 *   node scripts/auditoria-aa.mjs --ci   → sai com código 1 se houver achado GRAVE
 *
 * O que uma máquina CONSEGUE auditar, auditado sempre; a sessão com leitor
 * de tela e a navegação 100% por teclado continuam sendo validação com
 * gente (mesma honestidade de S25/S2/S24). Cinco verificações:
 *
 *  1. <img> sem alt (alt="" decorativo é correto; AUSENTE é grave).
 *  2. Botão só-de-ícone sem nome acessível (aria-label, title ou sr-only).
 *  3. onClick em div/span sem papel de botão (role/tabIndex).
 *  4. Fundamentos do documento: lang, prefers-reduced-motion, foco visível.
 *  5. CONTRASTE AA (4,5:1) dos pares de texto centrais do tema, claro e
 *     escuro, calculado dos tokens de verdade — não de uma tabela à parte.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const CI = process.argv.includes("--ci");
const graves = [];
const avisos = [];

function* arquivos(dir, ext) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) yield* arquivos(p, ext);
    else if (ext.some((e) => nome.endsWith(e))) yield p;
  }
}

// ---------- 1. <img> sem alt ----------
for (const p of [...arquivos("src", [".tsx"])]) {
  const s = readFileSync(p, "utf8");
  const tags = s.match(/<img\b[^>]*>/gs) ?? [];
  for (const t of tags) {
    if (!/\balt=/.test(t)) graves.push(`${p}: <img> sem alt (decorativa usa alt="").`);
  }
}

// ---------- 2. botão só-de-ícone sem nome ----------
for (const p of [...arquivos("src", [".tsx"])]) {
  const s = readFileSync(p, "utf8");
  const re = /<Button\b[^>]*size=["']icon["'][^>]*>([\s\S]*?)<\/Button>/g;
  let m;
  while ((m = re.exec(s))) {
    const bloco = m[0];
    const temNome =
      /aria-label=/.test(bloco) || /title=/.test(bloco) || /sr-only/.test(bloco) ||
      // texto visível dentro do botão
      /(^|>)\s*[^<>\s{][^<>]*(<|$)/.test(m[1].replace(/<[^>]+>/g, ""));
    if (!temNome) graves.push(`${p}: Button size="icon" sem nome acessível.`);
  }
}

// ---------- 3. onClick em div/span sem papel ----------
for (const p of [...arquivos("src", [".tsx"])]) {
  const s = readFileSync(p, "utf8");
  const re = /<(div|span)\b[^>]*onClick=[^>]*>/gs;
  let m;
  while ((m = re.exec(s))) {
    // O handler inline tem "=>" dentro — o fim real da tag fica adiante do
    // primeiro ">"; a janela de 250 chars cobre a abertura inteira.
    const janela = s.slice(m.index, m.index + 250);
    // Guardas de stopPropagation e backdrops aria-hidden não são interação:
    // o primeiro só cerca o clique, o segundo tem par de teclado no Escape.
    if (/stopPropagation|aria-hidden/.test(janela)) continue;
    if (!/role=|tabIndex=/.test(janela))
      avisos.push(`${p}: <${m[1]}> com onClick sem role/tabIndex (teclado não alcança).`);
  }
}

// ---------- 4. fundamentos ----------
const layout = readFileSync("src/app/layout.tsx", "utf8");
if (!/lang="pt-BR"/.test(layout)) graves.push("layout.tsx: <html> sem lang.");
const css = readFileSync("src/app/globals.css", "utf8");
if (!/prefers-reduced-motion/.test(css))
  graves.push("globals.css: sem bloco prefers-reduced-motion (S26).");
const button = readFileSync("src/components/ui/button.tsx", "utf8");
if (!/focus-visible/.test(button))
  graves.push("button.tsx: sem estilo de foco visível.");

// ---------- 5. contraste AA dos tokens ----------
function coletarTokens(bloco) {
  const out = new Map();
  const re = /--([\w-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(bloco))) out.set(m[1], m[2].trim());
  return out;
}
function resolver(tokens, nome, profundidade = 0) {
  const v = tokens.get(nome);
  if (!v || profundidade > 8) return null;
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolver(tokens, ref[1], profundidade + 1);
  return v;
}
function hslParaRgb(str) {
  const m = str.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
function luminancia([r, g, b]) {
  const c = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
  const la = luminancia(a), lb = luminancia(b);
  const [c, e] = la > lb ? [la, lb] : [lb, la];
  return (c + 0.05) / (e + 0.05);
}

const rootBloco = css.match(/:root\s*{([\s\S]*?)\n  }/)?.[1] ?? "";
const darkBloco = css.match(/\.dark\s*{([\s\S]*?)\n  }/)?.[1] ?? "";
const claro = coletarTokens(rootBloco);
const escuro = new Map([...claro, ...coletarTokens(darkBloco)]);

// Os pares de TEXTO que carregam o produto (AA texto normal = 4,5:1).
const PARES = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["primary-foreground", "primary"],
  ["destructive-foreground", "destructive"],
];
for (const [tema, tokens] of [["claro", claro], ["escuro", escuro]]) {
  for (const [fg, bg] of PARES) {
    const f = hslParaRgb(resolver(tokens, fg) ?? "");
    const b = hslParaRgb(resolver(tokens, bg) ?? "");
    if (!f || !b) {
      // Não resolver o par significa que o GATE deixou de conferir contraste —
      // isso reprova o CI em vez de virar aviso, senão o gate se desliga em silêncio.
      graves.push(`tema ${tema}: não resolvi ${fg}/${bg} para conferir contraste (gate cego).`);
      continue;
    }
    const c = contraste(f, b);
    if (c < 4.5)
      graves.push(
        `tema ${tema}: contraste ${fg} sobre ${bg} = ${c.toFixed(2)}:1 (AA exige 4,5:1).`
      );
  }
}

// ---------- relatório ----------
console.log(`auditoria AA — ${graves.length} grave(s), ${avisos.length} aviso(s)\n`);
for (const g of graves) console.log(`  GRAVE  ${g}`);
for (const a of avisos) console.log(`  aviso  ${a}`);
if (graves.length === 0) console.log("  ✓ nenhum achado grave");
console.log(
  "\nO que a máquina NÃO cobre e fica para a validação com gente: sessão de\n" +
    "leitor de tela (anúncio de status e base temporal) e navegação completa\n" +
    "por teclado de ponta a ponta (S26/S24)."
);
if (CI && graves.length > 0) process.exit(1);
