/**
 * TRAVA DE TOKENS DE DESIGN (F0.12 — ref. 02 §7.10).
 *
 * "Tokens são a única fonte de cor, tipo, espaço, raio, sombra e movimento;
 * classe crua de Tailwind na UI reprova no lint (exceção declarada: dataviz)."
 *
 * A regra entra PERMISSIVA, como manda a tarefa: o legado é fotografado numa
 * linha de base e o que existe hoje continua passando. O que a trava impede é
 * a dívida CRESCER — qualquer cor crua nova reprova.
 *
 * A linha de base só pode DIMINUIR: ao migrar um arquivo para tokens, rode
 * `--update` e o novo teto fica gravado. Aumentar exige mexer no arquivo de
 * base de propósito, e isso aparece na revisão.
 *
 * Uso:
 *   node scripts/check-design-tokens.mjs            (verifica)
 *   node scripts/check-design-tokens.mjs --update   (regrava a linha de base)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const RAIZ = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(RAIZ, "src");
const BASE = join(RAIZ, "design-tokens-baseline.json");

// Paletas cruas do Tailwind: o que deveria vir de token semântico.
const PALETAS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIXOS =
  "bg|text|border|ring|from|to|via|fill|stroke|shadow|divide|outline|decoration|accent|caret|placeholder";
const REGEX = new RegExp(`\\b(?:${PREFIXOS})-(?:${PALETAS})-(?:50|[1-9]00|950)\\b`, "g");

// Exceção declarada da especificação: dataviz tem paleta própria (02 §7.2).
const ISENTOS = [
  "src/components/charts.tsx",
  "src/components/dashboard/charts-lazy.tsx",
  "src/lib/metrics/",
];

function arquivos(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (nome.includes(" 2.")) continue; // duplicata do iCloud
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(tsx?|css)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const contagem = {};
for (const caminho of arquivos(SRC)) {
  const rel = relative(RAIZ, caminho);
  if (ISENTOS.some((i) => rel.startsWith(i))) continue;
  const achados = (readFileSync(caminho, "utf8").match(REGEX) ?? []).length;
  if (achados > 0) contagem[rel] = achados;
}

const total = Object.values(contagem).reduce((s, n) => s + n, 0);

if (process.argv.includes("--update")) {
  writeFileSync(BASE, JSON.stringify({ total, porArquivo: contagem }, null, 2) + "\n");
  console.log(`✓ linha de base regravada: ${total} ocorrência(s) em ${Object.keys(contagem).length} arquivo(s)`);
  process.exit(0);
}

if (!existsSync(BASE)) {
  console.error("✖ Linha de base ausente. Rode: node scripts/check-design-tokens.mjs --update");
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASE, "utf8"));
const problemas = [];

for (const [arquivo, n] of Object.entries(contagem)) {
  const teto = base.porArquivo[arquivo] ?? 0;
  if (n > teto) {
    problemas.push(
      teto === 0
        ? `${arquivo}: ${n} cor(es) crua(s) em arquivo que não tinha nenhuma`
        : `${arquivo}: ${n} cor(es) cruas (a linha de base permite ${teto})`
    );
  }
}

if (problemas.length > 0) {
  console.error("\n✖ Cores cruas de Tailwind acima da linha de base (02 §7.10)\n");
  for (const p of problemas) console.error("  · " + p);
  console.error(
    "\n  Use os tokens semânticos (text-foreground, bg-card, text-destructive…).\n" +
      "  Se a cor for de dataviz, o arquivo entra na lista de isentos do script.\n" +
      "  Se você MIGROU um arquivo e o total caiu, regrave a base com --update.\n"
  );
  process.exit(1);
}

const migrados = Object.entries(base.porArquivo).filter(
  ([arquivo, n]) => (contagem[arquivo] ?? 0) < n
).length;
console.log(
  `✓ tokens de design: ${total} cor(es) crua(s) no legado, dentro da linha de base` +
    (migrados > 0 ? ` · ${migrados} arquivo(s) melhoraram (rode --update para baixar o teto)` : "")
);
