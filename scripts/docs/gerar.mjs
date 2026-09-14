/**
 * GERADOR DA DOCUMENTAÇÃO DO B2C FINANCE.
 *
 *   node scripts/docs/gerar.mjs [pasta-de-saida]
 *
 * Monta a documentação completa a partir do CÓDIGO (via extrair.mjs) mais a
 * narrativa escrita à mão em scripts/docs/secoes/*.md.
 *
 * Por que gerar em vez de escrever: a documentação anterior foi redigida à
 * mão em 29/08/2026 e envelheceu sem avisar — descrevia reservas de caixa
 * removidas do produto em 10/09 e ignorava telas criadas depois. Número que
 * sai do código não tem como divergir do código.
 *
 * O que continua sendo humano: o PORQUÊ. Nenhum extrator adivinha por que a
 * data civil é ancorada em UTC ou por que o vencido fica fora da projeção.
 * Essas partes vivem em secoes/ e são costuradas aqui.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import * as X from "./extrair.mjs";
import { markdownParaHtml, ancora } from "./markdown.mjs";

const SAIDA = process.argv[2] ?? "docs/gerado";
const HOJE = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });

function git(cmd, padrao = "—") {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8" }).trim() || padrao;
  } catch {
    return padrao;
  }
}

const secao = (nome) => {
  const p = join("scripts/docs/secoes", nome);
  return existsSync(p) ? readFileSync(p, "utf8").trimEnd() : "";
};

/** Tabela markdown a partir de cabeçalhos e linhas. */
function tabela(cabecalhos, linhas) {
  if (linhas.length === 0) return "_Nenhum registro._";
  const esc = (v) =>
    String(v ?? "—").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
  return [
    `| ${cabecalhos.join(" | ")} |`,
    `| ${cabecalhos.map(() => "---").join(" | ")} |`,
    ...linhas.map((l) => `| ${l.map(esc).join(" | ")} |`),
  ].join("\n");
}

const cod = (v) => (v == null || v === "" ? "—" : `\`${v}\``);

/**
 * Escapa uma célula montada à mão, fora do helper `tabela`.
 * O texto de `roas` contém "primeiro mês | valor contratual | outra": sem
 * escapar, o pipe vira separador e a linha ganha colunas a mais.
 */
const cel = (v) =>
  v == null || v === "" ? "—" : String(v).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

// ===================================================================
// COLETA
// ===================================================================
console.log("Lendo o código-fonte…");
const D = {
  rotas: X.rotas(),
  api: X.rotasDeApi(),
  modelos: X.modelos(),
  enums: X.enums(),
  migrations: X.migrations(),
  permissoes: X.permissoes(),
  metricas: X.metricas(),
  relatorios: X.relatorios(),
  acoes: X.acoes(),
  services: X.services(),
  componentes: X.componentes(),
  tokens: X.tokens(),
  testes: X.testes(),
  env: X.variaveisDeAmbiente(),
  pacote: X.pacote(),
  navegacao: X.navegacao(),
  aposentadas: X.rotasAposentadas(),
};

const N = {
  rotas: D.rotas.length,
  api: D.api.length,
  modelos: D.modelos.length,
  enums: D.enums.length,
  migrations: D.migrations.length,
  permissoes: D.permissoes.grupos.reduce((t, g) => t + g.permissoes.length, 0),
  papeis: D.permissoes.papeis.length,
  metricas: D.metricas.length,
  metricasVigentes: new Set(D.metricas.filter((m) => !m.vigenteAte).map((m) => m.chave)).size,
  relatorios: D.relatorios.length,
  acoes: D.acoes.reduce((t, a) => t + a.funcoes.length, 0),
  services: D.services.length,
  componentes: D.componentes.length,
  testes: D.testes.length,
  casos: D.testes.reduce((t, x) => t + x.casos, 0),
};

const META = {
  commit: git("rev-parse --short HEAD"),
  branch: git("rev-parse --abbrev-ref HEAD"),
  dataCommit: git("log -1 --format=%cd --date=format:%d/%m/%Y"),
  totalCommits: git("rev-list --count HEAD", "0"),
};

// ===================================================================
// CAPÍTULOS
// ===================================================================
const capitulos = [];
const cap = (arquivo, titulo, corpo) => capitulos.push({ arquivo, titulo, corpo });

// ---------- 1. Visão geral ----------
cap("01-visao-geral.md", "Visão geral", `
# 1 · Visão geral

${secao("visao-geral.md")}

## O sistema em números

| | |
|---|---|
| Telas | ${N.rotas} |
| Rotas de API | ${N.api} |
| Tabelas no banco | ${N.modelos} |
| Enumerações | ${N.enums} |
| Migrações aplicadas | ${N.migrations} |
| Métricas com contrato | ${N.metricasVigentes} vigentes (${N.metricas} entradas, com as versões antigas) |
| Relatórios | ${N.relatorios} |
| Permissões | ${N.permissoes}, em ${D.permissoes.grupos.length} grupos |
| Papéis de acesso | ${N.papeis} |
| Operações de escrita (server actions) | ${N.acoes}, em ${D.acoes.length} módulos |
| Serviços de domínio | ${N.services} |
| Componentes de interface | ${N.componentes} |
| Testes automatizados | ${N.casos} casos, em ${N.testes} arquivos |

## Tecnologia

| Camada | Escolha |
|---|---|
| Framework | Next.js ${D.pacote.dependencias.next?.replace("^", "")} (App Router) |
| Linguagem | TypeScript ${D.pacote.desenvolvimento.typescript?.replace("^", "")} |
| Banco | PostgreSQL via Prisma ${D.pacote.dependencias["@prisma/client"]?.replace("^", "")} |
| Interface | React ${D.pacote.dependencias.react?.replace("^", "")}, Tailwind, Radix |
| Gráficos | Recharts ${D.pacote.dependencias.recharts?.replace("^", "")} |
| Testes | Vitest ${D.pacote.desenvolvimento.vitest?.replace("^", "")} |
| Publicação | Vercel, por integração Git na branch \`main\` |

## Comandos

${tabela(["Comando", "O que faz"], Object.entries(D.pacote.scripts)
  .filter(([k]) => ["dev", "build", "verify", "test", "lint", "audit:aa", "lint:tokens", "db:seed", "db:migrate:deploy"].includes(k))
  .map(([k, v]) => [cod(`npm run ${k}`), cod(v)]))}

O portão completo é \`npm run verify\`: lint, trava de tokens, auditoria de
acessibilidade, build e testes, nessa ordem.
`);

// ---------- 2. Mapa de telas ----------
const porArea = new Map();
for (const area of D.navegacao) {
  for (const p of area.paginas) porArea.set(p.href, area.label);
}
cap("02-telas.md", "Mapa de telas", `
# 2 · Mapa de telas

São ${N.rotas} telas. A navegação as organiza em ${D.navegacao.length} espaços
de trabalho; as demais são acessíveis por link contextual.

## Navegação

${D.navegacao.map((a) => `### ${a.label}\n\n${tabela(
  ["Tela", "Rota", "Permissão"],
  a.paginas.map((p) => [p.label, cod(p.href), cod(p.permissao)])
)}`).join("\n\n")}

## Todas as telas

${tabela(["Rota", "Espaço", "Permissão exigida", "Propósito"],
  D.rotas.map((r) => [
    cod(r.rota),
    porArea.get(r.rota) ?? "—",
    cod(r.permissao),
    r.proposito ?? "—",
  ]))}

## Rotas de API

${tabela(["Rota", "Métodos"], D.api.map((r) => [cod(r.rota), r.metodos.join(", ") || "—"]))}

## Rotas aposentadas

Link de notificação, e-mail ou rotina fica **gravado no banco** e sobrevive a
qualquer renomeação de rota. Por isso rota aposentada ganha redirecionamento
permanente em vez de simplesmente sumir.

${tabela(["Origem", "Destino"], D.aposentadas.map((r) => [cod(r.origem), cod(r.destino)]))}
`);

// ---------- 3. Domínio e banco ----------
cap("03-dominio.md", "Domínio e banco de dados", `
# 3 · Domínio e banco de dados

${secao("dominio.md")}

## Tabelas (${N.modelos})

${tabela(["Tabela", "Campos", "O que guarda"],
  D.modelos.map((m) => [cod(m.nome), m.totalCampos, m.doc ?? "—"]))}

## Enumerações (${N.enums})

${tabela(["Enumeração", "Valores", "Significado"],
  D.enums.map((e) => [cod(e.nome), e.valores.map((v) => `\`${v}\``).join(" "), e.doc ?? "—"]))}

## Histórico de migrações

${N.migrations} migrações aplicadas, da mais antiga à mais recente.

${tabela(["Data", "Migração"], D.migrations.map((m) => [m.data ?? "—", m.nome]))}
`);

// ---------- 4. Métricas ----------
const porBase = (b) => D.metricas.filter((m) => m.base === b && !m.vigenteAte);
cap("04-metricas.md", "Dicionário de métricas", `
# 4 · Dicionário de métricas

${secao("metricas.md")}

## Índice por base temporal

${tabela(["Base temporal", "O que significa", "Métricas"], [
  ["COMPETENCE", "O mês a que o resultado pertence", porBase("COMPETENCE").length],
  ["CASH", "O dia em que o dinheiro entrou ou saiu", porBase("CASH").length],
  ["CURRENT_STATE", "O que vale agora — não tem período", porBase("CURRENT_STATE").length],
  ["SNAPSHOT", "O valor congelado no fechamento", porBase("SNAPSHOT").length],
])}

## Todas as métricas

${D.metricas.filter((m) => !m.vigenteAte).map((m) => `
### \`${m.chave}\` — ${m.nome}${m.versao > 1 ? ` (v${m.versao})` : ""}

${m.descricao ?? ""}

| | |
|---|---|
| **Como é somado** | ${cel(m.formula)} |
| **Base temporal** | \`${m.base}\` |
| **Grão** | \`${m.grao}\` |
| **Origem dos dados** | ${m.origens.map((o) => `\`${o}\``).join(", ") || "—"} |
${m.filtros ? `| **Inclui / exclui** | ${cel(m.filtros)} |\n` : ""}${m.arredondamento ? `| **Arredondamento** | ${cel(m.arredondamento)} |\n` : ""}${m.nulo ? `| **Quando não dá** | ${cel(m.nulo)} |\n` : ""}| **Definição** | ${cel(m.spec)} |
`).join("\n")}

## Versões anteriores

Quando uma fórmula muda, a entrada antiga **fica** e nasce uma versão nova. É
isso que faz o passado continuar reportando a fórmula que usou.

${tabela(["Métrica", "Versão", "Valeu até", "Fórmula de então"],
  D.metricas.filter((m) => m.vigenteAte)
    .map((m) => [cod(m.chave), m.versao, m.vigenteAte, m.formula ?? "—"]))}
`);

// ---------- 5. Relatórios ----------
cap("05-relatorios.md", "Relatórios", `
# 5 · Relatórios

São ${N.relatorios} relatórios, todos servidos pela mesma rota
\`/relatorios/[tipo]\` a partir de uma definição declarativa: colunas, filtros,
agrupamentos e totais saem do registro, não de código por relatório.

${tabela(["Relatório", "Chave", "Colunas", "O que responde"],
  D.relatorios.map((r) => [r.titulo, cod(r.chave), r.colunas.length, r.descricao ?? "—"]))}

## Colunas de cada relatório

${D.relatorios.map((r) => `### ${r.titulo}\n\n\`${r.chave}\` — ${r.descricao ?? ""}\n\n${
  r.colunas.length ? r.colunas.map((c) => `- ${c}`).join("\n") : "_Sem colunas declaradas._"
}`).join("\n\n")}
`);

// ---------- 6. Permissões ----------
cap("06-permissoes.md", "Papéis e permissões", `
# 6 · Papéis e permissões

${secao("permissoes.md")}

## Papéis

${tabela(["Papel", "Permissões", "Alcance"],
  D.permissoes.papeis.map((p) => [
    cod(p.papel),
    p.tudo ? "todas" : p.quantidade,
    p.descricao ?? "—",
  ]))}

## Catálogo de permissões

Permissão marcada como **sensível** envolve dinheiro, exclusão ou configuração
estrutural.

${D.permissoes.grupos.map((g) => `### ${g.label}\n\n${tabela(
  ["Permissão", "O que libera", "Sensível"],
  g.permissoes.map((p) => [cod(p.id), p.label, p.sensivel ? "sim" : "—"])
)}`).join("\n\n")}
`);

// ---------- 7. Operações ----------
cap("07-operacoes.md", "Operações de escrita", `
# 7 · Operações de escrita

Toda gravação passa por uma *server action*, e toda server action começa
verificando permissão. São ${N.acoes} operações em ${D.acoes.length} módulos.

${tabela(["Módulo", "Operações", "Permissões exigidas"],
  D.acoes.map((a) => [
    cod(a.modulo),
    a.funcoes.length,
    a.permissoes.map((p) => `\`${p}\``).join(" ") || "—",
  ]))}

## Detalhe por módulo

${D.acoes.map((a) => `### \`${a.modulo}\`\n\n${a.funcoes.map((f) => `- \`${f}()\``).join("\n")}`).join("\n\n")}

## Serviços de domínio

A regra de negócio mora aqui, não na tela: a tela lê e exibe, o serviço decide.

${tabela(["Serviço", "Propósito"],
  D.services.map((s) => [cod(s.modulo), s.proposito ?? "—"]))}
`);

// ---------- 8. Design ----------
const tokensDeCor = Object.entries(D.tokens.claro)
  .filter(([k]) => !k.startsWith("blue-") && !k.startsWith("slate-") && !k.startsWith("radius") && !k.startsWith("dur-") && !k.startsWith("ease-"));
cap("08-design.md", "Design system", `
# 8 · Design system

${secao("design.md")}

## Tokens de cor

Nenhuma cor literal vive na interface: tudo aponta para um token semântico, e
a trava \`npm run lint:tokens\` fiscaliza isso.

${tabela(["Token", "Tema claro", "Tema escuro"],
  tokensDeCor.map(([k, v]) => [cod(`--${k}`), v, D.tokens.escuro[k] ?? "_(herda do claro)_"]))}

## Forma e movimento

${tabela(["Token", "Valor"],
  Object.entries(D.tokens.claro)
    .filter(([k]) => k.startsWith("radius") || k.startsWith("dur-") || k.startsWith("ease-"))
    .map(([k, v]) => [cod(`--${k}`), cod(v)]))}

## Componentes

${tabela(["Arquivo", "Exporta", "Propósito"],
  D.componentes.map((c) => [
    cod(c.arquivo),
    c.exporta.map((e) => `\`${e}\``).join(" "),
    c.proposito ?? "—",
  ]))}
`);

// ---------- 9. Qualidade ----------
cap("09-qualidade.md", "Testes e portões de qualidade", `
# 9 · Testes e portões de qualidade

${secao("qualidade.md")}

## Suíte de testes

${N.casos} casos em ${N.testes} arquivos.

${tabela(["Arquivo", "Casos", "O que guarda"],
  D.testes.map((t) => [cod(t.arquivo), t.casos, t.proposito ?? t.suites[0] ?? "—"]))}
`);

// ---------- 10. Operação ----------
cap("10-operacao.md", "Instalação e operação", `
# 10 · Instalação e operação

${secao("operacao.md")}

## Variáveis de ambiente

${tabela(["Variável", "Documentada em .env.example", "Onde é lida"],
  D.env.map((e) => [
    cod(e.nome),
    e.documentada ? "sim" : "**não**",
    e.usos.map((u) => `\`${u.replace("src/", "")}\``).join(" "),
  ]))}

## Todos os comandos

${tabela(["Comando", "Executa"],
  Object.entries(D.pacote.scripts).map(([k, v]) => [cod(`npm run ${k}`), cod(v)]))}
`);

// ===================================================================
// ESCRITA
// ===================================================================
mkdirSync(SAIDA, { recursive: true });

const capaTexto = `# B2C Finance — Documentação do sistema

**ERP financeiro e comercial da agência B2C Gestão**

> Gerado a partir do código-fonte em ${HOJE}.
> Commit \`${META.commit}\` na branch \`${META.branch}\` (${META.dataCommit}).

---

## O que é este documento

A referência completa do sistema **como ele está hoje**: cada tela, cada
tabela, cada métrica, cada permissão e cada regra que o código realmente
aplica.

Ele é **gerado**, não redigido. Os números, as listas e as tabelas saem
diretamente do código-fonte pelo comando \`node scripts/docs/gerar.mjs\`; a
narrativa que explica o *porquê* de cada decisão vive em
\`scripts/docs/secoes/\` e é costurada na geração.

Isso não é preciosismo de processo. A documentação anterior deste sistema foi
escrita à mão em 29/08/2026 e envelheceu em silêncio: descrevia reservas de
caixa que saíram do produto em 10/09 e desconhecia telas criadas depois.
Documentação que não nasce do código volta a mentir na primeira semana — e
documentação financeira que mente é pior que documentação nenhuma.

## Como ler

| Capítulo | Para quem | Responde |
|---|---|---|
| [1 · Visão geral](01-visao-geral.md) | todos | o que o sistema é e em que escala |
| [2 · Mapa de telas](02-telas.md) | produto, suporte | onde fica cada coisa |
| [3 · Domínio e banco](03-dominio.md) | engenharia | como os dados são modelados |
| [4 · Dicionário de métricas](04-metricas.md) | financeiro, direção | o que cada número significa |
| [5 · Relatórios](05-relatorios.md) | financeiro | o que dá para extrair |
| [6 · Papéis e permissões](06-permissoes.md) | administração | quem pode o quê |
| [7 · Operações de escrita](07-operacoes.md) | engenharia | o que altera dado, e sob qual permissão |
| [8 · Design system](08-design.md) | design, engenharia | as fundações visuais |
| [9 · Testes e portões](09-qualidade.md) | engenharia | o que impede regressão |
| [10 · Instalação e operação](10-operacao.md) | engenharia, infra | como rodar e publicar |

Quem precisa de **um número específico** começa pelo capítulo 4: ele diz a
fórmula, a base temporal e o que entra e o que fica de fora. É o capítulo que
resolve a pergunta "por que esta tela mostra um valor e aquela mostra outro".

## O sistema em números

| | |
|---|---|
| Telas | ${N.rotas} |
| Tabelas no banco | ${N.modelos} |
| Métricas com contrato | ${N.metricasVigentes} |
| Relatórios | ${N.relatorios} |
| Permissões | ${N.permissoes} em ${N.papeis} papéis |
| Operações de escrita | ${N.acoes} |
| Testes | ${N.casos} |
| Migrações | ${N.migrations} |
| Commits no histórico | ${META.totalCommits} |

## Como manter atualizado

\`\`\`bash
node scripts/docs/gerar.mjs                 # regenera em docs/gerado/
node scripts/docs/gerar.mjs ~/Downloads/doc # ou onde você quiser
\`\`\`

Rode depois de qualquer mudança em telas, modelos, métricas ou permissões. Se
o capítulo mudar, é porque o sistema mudou.
`;

writeFileSync(join(SAIDA, "README.md"), capaTexto);
for (const c of capitulos) writeFileSync(join(SAIDA, c.arquivo), c.corpo.trimStart());

// Arquivo único, para quem prefere ler ou imprimir tudo de uma vez.
const unico = [
  capaTexto,
  ...capitulos.map((c) => `\n\n---\n\n${c.corpo.trimStart()}`),
].join("");
writeFileSync(join(SAIDA, "B2C-Finance-Documentacao-Completa.md"), unico);

// ===================================================================
// HTML — um arquivo só, navegável e imprimível, sem depender de rede
// ===================================================================
const indice = [
  { id: "capa", titulo: "Capa e índice", md: capaTexto },
  ...capitulos.map((c) => ({
    id: c.arquivo.replace(".md", ""),
    titulo: c.titulo,
    md: c.corpo,
  })),
];

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>B2C Finance — Documentação do sistema</title>
<style>
  /* Mesmos tokens do produto: a documentação parece parte do sistema. */
  :root {
    --canvas: #F5F8FC; --surface: #FFFFFF; --sunken: #EDF2F9;
    --texto: #142B45; --suave: #5B6C84; --linha: #D6E0EE;
    --marca: #216FD3; --marca-suave: #E9F1FC;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --canvas: #0B192B; --surface: #10253E; --sunken: #0D1F35;
      --texto: #F2F6FD; --suave: #A8BBD4; --linha: #2C405C;
      --marca: #80B4FF; --marca-suave: #172F4E;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--canvas); color: var(--texto);
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  #capa-do-doc {
    background: linear-gradient(160deg, #142B45, #0B192B);
    color: #F2F6FD; padding: 64px 32px 56px; text-align: center;
  }
  #capa-do-doc h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: -0.02em; }
  #capa-do-doc p { margin: 0; color: #A8BBD4; font-size: 15px; }
  .envolve { display: flex; max-width: 1360px; margin: 0 auto; align-items: flex-start; }
  nav {
    position: sticky; top: 0; flex: 0 0 260px; max-height: 100vh; overflow-y: auto;
    padding: 24px 16px; border-right: 1px solid var(--linha);
  }
  nav strong {
    display: block; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--suave); margin: 0 0 10px 10px;
  }
  nav a {
    display: block; padding: 7px 10px; border-radius: 8px; margin-bottom: 2px;
    color: var(--texto); text-decoration: none; font-size: 14px;
  }
  nav a:hover { background: var(--sunken); }
  nav a.ativo { background: var(--marca-suave); color: var(--marca); font-weight: 600; }
  main { flex: 1 1 auto; min-width: 0; padding: 32px 40px 96px; }
  section { display: none; }
  section.visivel { display: block; }
  h1, h2, h3, h4 { letter-spacing: -0.02em; line-height: 1.25; }
  h1 { font-size: 30px; margin: 8px 0 20px; }
  h2 { font-size: 21px; margin: 36px 0 12px; padding-top: 14px; border-top: 1px solid var(--linha); }
  h3 { font-size: 16px; margin: 26px 0 8px; }
  h3 code { font-size: 15px; }
  p { margin: 0 0 12px; }
  a { color: var(--marca); }
  code {
    font-family: var(--mono); font-size: 0.88em; background: var(--sunken);
    padding: 1px 5px; border-radius: 5px; white-space: nowrap;
  }
  pre {
    background: var(--sunken); border: 1px solid var(--linha); border-radius: 12px;
    padding: 14px 16px; overflow-x: auto;
  }
  pre code { background: none; padding: 0; white-space: pre; font-size: 13px; }
  blockquote {
    margin: 14px 0; padding: 2px 16px; border-left: 3px solid var(--marca);
    background: var(--marca-suave); border-radius: 0 10px 10px 0;
  }
  blockquote p { margin: 10px 0; }
  .rolagem { overflow-x: auto; margin: 14px 0; }
  table {
    border-collapse: collapse; width: 100%; font-size: 13.5px;
    background: var(--surface); border-radius: 10px; overflow: hidden;
  }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--linha); vertical-align: top; }
  th { background: var(--sunken); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); }
  tbody tr:last-child td { border-bottom: none; }
  ul, ol { margin: 0 0 12px; padding-left: 22px; }
  li { margin-bottom: 4px; }
  hr { border: none; border-top: 1px solid var(--linha); margin: 28px 0; }
  #abrir-menu { display: none; }

  @media (max-width: 900px) {
    .envolve { display: block; }
    nav { position: static; width: auto; max-height: none; border-right: none; border-bottom: 1px solid var(--linha); }
    main { padding: 24px 18px 72px; }
    #capa-do-doc { padding: 44px 20px 36px; }
    #capa-do-doc h1 { font-size: 26px; }
  }

  /* Impressão: tudo visível, de uma vez, sem navegação. */
  @media print {
    nav { display: none; }
    section { display: block !important; page-break-before: always; }
    section:first-of-type { page-break-before: avoid; }
    body { background: #fff; color: #000; font-size: 11pt; }
    #capa-do-doc { background: none; color: #000; border-bottom: 2px solid #000; }
    #capa-do-doc p { color: #444; }
    table { font-size: 9pt; }
    h2 { page-break-after: avoid; }
    .rolagem { overflow: visible; }
  }
</style>
</head>
<body>
<header id="capa-do-doc">
  <h1>B2C Finance</h1>
  <p>Documentação do sistema · gerada do código em ${HOJE} · commit ${META.commit}</p>
</header>
<div class="envolve">
  <nav>
    <strong>Capítulos</strong>
    ${indice.map((c, i) => `<a href="#${c.id}" data-alvo="${c.id}"${i === 0 ? ' class="ativo"' : ""}>${c.titulo}</a>`).join("\n    ")}
  </nav>
  <main>
    ${indice.map((c, i) => `<section id="${c.id}"${i === 0 ? ' class="visivel"' : ""}>${markdownParaHtml(c.md)}</section>`).join("\n    ")}
  </main>
</div>
<script>
  // Navegação por capítulo. Sem framework de propósito: o arquivo precisa
  // abrir por duplo clique daqui a anos, sem rede e sem build.
  var elos = document.querySelectorAll("nav a");
  function mostrar(id) {
    document.querySelectorAll("section").forEach(function (s) {
      s.classList.toggle("visivel", s.id === id);
    });
    elos.forEach(function (a) { a.classList.toggle("ativo", a.dataset.alvo === id); });
    window.scrollTo(0, 0);
  }
  elos.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      mostrar(a.dataset.alvo);
      history.replaceState(null, "", "#" + a.dataset.alvo);
    });
  });
  // Link interno entre capítulos (ex.: da capa para o capítulo 4).
  document.querySelectorAll('main a[href$=".md"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").replace(".md", "");
      if (document.getElementById(id)) { e.preventDefault(); mostrar(id); }
    });
  });
  if (location.hash && document.getElementById(location.hash.slice(1))) {
    mostrar(location.hash.slice(1));
  }
</script>
</body>
</html>`;

writeFileSync(join(SAIDA, "B2C-Finance-Documentacao.html"), html);

console.log(`\nDocumentação gerada em ${SAIDA}/`);
for (const n of readdirSync(SAIDA).sort()) {
  const kb = (readFileSync(join(SAIDA, n), "utf8").length / 1024).toFixed(0);
  console.log(`  ${n.padEnd(42)} ${kb.padStart(5)} KB`);
}
