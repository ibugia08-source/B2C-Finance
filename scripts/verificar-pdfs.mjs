/**
 * VERIFICAÇÃO DE INTEGRIDADE DOS PDFs DE RELATÓRIO (P0.1 da auditoria).
 *
 * A auditoria de 10/09/2026 encontrou nove relatórios perdendo conteúdo no
 * PDF, e encontrou ABRINDO os arquivos — não olhando a tela. Este script faz
 * a mesma coisa, toda vez, sem ninguém: gera os 18 PDFs num navegador de
 * verdade, EXTRAI O TEXTO de dentro do arquivo e confere o que a auditoria
 * mandou conferir.
 *
 * O que ele prova (testes 12, 13 e 14 da auditoria):
 *
 *  - TODA coluna essencial aparece no texto do PDF, inclusive a ÚLTIMA (o
 *    corte à direita era sempre nela);
 *  - a contagem de linhas do documento bate com a da consulta — nenhuma
 *    linha se perde na paginação;
 *  - nenhuma página contém só rodapé (as "páginas órfãs" dos PDFs 03 e 09);
 *  - nada transborda a área imprimível (a régua é o próprio layout, medido
 *    com o navegador em mídia de impressão).
 *
 * Conferir só a tela NÃO serve, e é a lição que a auditoria deixou: o que
 * rola dentro de um contêiner no monitor some no papel sem avisar ninguém.
 *
 * Uso:
 *   node scripts/verificar-pdfs.mjs --base http://localhost:3100 \
 *        --token <cookie b2c_session> [--saida docs/pdfs-v2/p0.1]
 *
 * Sem --token o script mina um pelo scripts/mint-token.ts do ambiente local.
 * CHROMIUM_PATH aponta o binário quando não há download do Playwright.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]?.startsWith("--") ? "1" : arr[i + 1]]] : []
  )
);

const BASE = args.base ?? process.env.BASE_URL ?? "http://localhost:3100";
const SAIDA = args.saida ?? null;
const SO = args.so ? args.so.split(",") : null;
/**
 * TAMANHOS do teste 12: 0, 1, 8, 9 e 120+ registros no MESMO relatório.
 *
 * A fatia é por status do cliente porque a semente de estresse cria
 * exatamente essas quantidades — assim o verificador não conta "umas cento e
 * tantas", ele exige o número. O relatório escolhido é o de Clientes: é o
 * mais largo do catálogo (dez colunas) e foi o que a auditoria pegou
 * perdendo receita, aberto e vencido no papel.
 */
const TAMANHOS = [
  { rotulo: "0 registros", qs: "responsavel=Estresse+T000", esperado: 0 },
  { rotulo: "1 registro", qs: "responsavel=Estresse+T001", esperado: 1 },
  { rotulo: "8 registros", qs: "responsavel=Estresse+T008", esperado: 8 },
  { rotulo: "9 registros", qs: "responsavel=Estresse+T009", esperado: 9 },
  { rotulo: "130 registros", qs: "responsavel=Estresse+T130", esperado: 130 },
];

/**
 * Colunas ESSENCIAIS por relatório: as que não podem faltar no papel.
 *
 * A última de cada lista é, de propósito, a ÚLTIMA COLUNA do relatório —
 * é nela que o corte da auditoria aparecia primeiro. A lista é escrita à
 * mão (e não derivada do registry) porque derivá-la do mesmo código que
 * renderiza faria o teste concordar com o defeito.
 */
const ESSENCIAIS = {
  "financeiro-mensal": ["Mês", "Receitas", "Despesas", "Folha", "Margem"],
  clientes: ["Cliente", "Valor mensal", "Receita total", "Em aberto", "Vencido", "Cliente desde"],
  inadimplencia: ["Cliente", "Vencido", "Dias em atraso", "Faixa", "Último contato"],
  contratos: ["Contrato", "Cliente", "Valor mensal", "Valor total", "Renovação"],
  despesas: ["Data", "Descrição", "Categoria", "Vencimento", "Valor"],
  folha: ["Competência", "Colaborador", "Valor"],
  caixa: ["Data", "Descrição", "Entrada", "Saída"],
  "rentabilidade-cliente": ["Cliente", "Receita", "Custos diretos", "Margem", "% Margem"],
  "margem-totalmente-alocada": ["Cliente", "Receita", "Margem de contribuição", "Overhead alocado", "Margem final", "% Margem final"],
  recebimentos: ["Cliente", "Valor", "Vencimento", "Competência", "Situação"],
  "receita-extra": ["Descrição", "Valor", "Competência original", "Recebida em"],
  mrr: ["Cliente", "Valor mensal", "Anualizado"],
  tcv: ["Cliente", "Valor", "Recebido"],
  renovacoes: ["Cliente", "Renovação", "Valor esperado"],
  perdas: ["Data da perda", "Cliente", "Motivo", "Receita perdida"],
  "clientes-por-responsavel": ["Responsável", "Ativos", "MRR"],
  upsell: ["Cliente", "Oportunidade", "Status", "Valor"],
  executivo: ["Grupo", "Indicador", "Valor"],
};

function log(...x) {
  console.log(...x);
}

async function textoDoPdf(caminho) {
  // A build "legacy" é a que roda em Node sem canvas.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(caminho)),
    useSystemFonts: true,
  }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    paginas.push(conteudo.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim());
  }
  await doc.cleanup?.();
  doc.destroy?.();
  return paginas;
}

function token() {
  if (args.token) return args.token;
  if (process.env.B2C_TOKEN) return process.env.B2C_TOKEN;
  const saida = execFileSync("npx", ["tsx", "scripts/mint-token.ts"], { encoding: "utf8" });
  const m = saida.match(/TOKEN=([\w.\-]+)/);
  if (!m) throw new Error("Não consegui minar um token (use --token).");
  return m[1];
}

async function main() {
  const relatorios = (SO ?? Object.keys(ESSENCIAIS)).filter((k) => ESSENCIAIS[k]);
  const dominio = new URL(BASE).hostname;
  const saidaDir = SAIDA ? join(process.cwd(), SAIDA) : null;
  if (saidaDir) mkdirSync(saidaDir, { recursive: true });

  const navegador = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addCookies([
    { name: "b2c_session", value: token(), domain: dominio, path: "/" },
  ]);
  const pagina = await ctx.newPage();

  const falhas = [];
  const resumo = [];

  async function conferir(chave, qs, rotulo, esperado) {
    const nome = rotulo ? `${chave} (${rotulo})` : chave;
    const url = `${BASE}/relatorios/${chave}/pdf${qs ? `?${qs}` : ""}`;
    const erro = (msg) => falhas.push(`${nome}: ${msg}`);

    // Medir em MÍDIA DE IMPRESSÃO: na tela a folha tem sombra e padding de
    // pré-visualização, e medir aquilo mede o simulador, não o papel.
    await pagina.emulateMedia({ media: "print" });
    const resposta = await pagina.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    if (!resposta || resposta.status() >= 400) {
      erro(`a rota respondeu ${resposta?.status() ?? "sem resposta"}`);
      return;
    }
    // O paginador marca o documento quando termina de medir.
    await pagina
      .waitForFunction(() => document.documentElement.dataset.paginado, { timeout: 15_000 })
      .catch(() => erro("o paginador não concluiu (documento sem numeração)"));

    const medido = await pagina.evaluate(() => {
      const folhas = [...document.querySelectorAll(".doc-folha")];
      const raiz = getComputedStyle(document.documentElement);
      const mm = (v) => parseFloat(raiz.getPropertyValue(v));
      const PX = 96 / 25.4;
      return {
        orientacao: document.querySelector(".doc")?.getAttribute("data-orientacao"),
        folhas: folhas.length,
        linhas: document.querySelectorAll(".doc-tabela tbody tr").length,
        colunas: [...document.querySelectorAll(".doc-folha thead th")].map((t) =>
          (t.textContent ?? "").trim()
        ),
        // Transbordo horizontal: o inimigo original. Medido no elemento da
        // folha contra a largura útil declarada no @page.
        transbordo: folhas.map((f) => ({
          conteudo: f.querySelector(".doc-tabela")?.scrollWidth ?? 0,
          util: Math.round(mm("--doc-largura") * PX),
        })),
        alturaUtil: Math.round(mm("--doc-altura") * PX),
        alturaDasFolhas: folhas.map((f) => f.scrollHeight),
        vazio: !!document.querySelector(".doc-tabela tbody tr td[colspan]"),
      };
    });

    const arquivo = join(
      saidaDir ?? process.env.TMPDIR ?? "/tmp",
      `${await pagina.title()}.pdf`
    );
    await pagina.pdf({ path: arquivo, preferCSSPageSize: true, printBackground: true });
    const paginas = await textoDoPdf(arquivo);
    const texto = paginas.join(" ");
    // O cabeçalho da tabela é maiúsculo por CSS, e o text-transform chega
    // ASSIM no texto do PDF ("VENCIDO", não "Vencido"). Comparar sem caixa
    // é o que faz o teste medir presença de coluna, e não tipografia.
    const textoNormalizado = texto.toUpperCase();

    // 1. colunas essenciais presentes no TEXTO DO PDF (não na tela).
    const faltando = ESSENCIAIS[chave].filter(
      (c) => !textoNormalizado.includes(c.toUpperCase())
    );
    if (faltando.length) erro(`colunas ausentes no PDF: ${faltando.join(", ")}`);

    // 2. nenhuma página só com rodapé (teste 13).
    const orfas = paginas
      .map((t, i) => ({ n: i + 1, t }))
      .filter(({ t }) => t.length < 220 && /página \d+ de \d+/i.test(t) && !/[A-Za-z]{3,}.*\d/.test(t.replace(/página \d+ de \d+/i, "")));
    if (orfas.length) erro(`página(s) só com rodapé: ${orfas.map((o) => o.n).join(", ")}`);

    // 3. transbordo horizontal (a causa do corte à direita).
    const estourou = medido.transbordo.filter((t) => t.conteudo > t.util + 2);
    if (estourou.length)
      erro(`tabela ${estourou[0].conteudo}px numa área de ${estourou[0].util}px — corta à direita`);

    // 4. folha mais alta que a área útil = conteúdo empurrado para fora.
    const altas = medido.alturaDasFolhas.filter((h) => h > medido.alturaUtil + 4);
    if (altas.length) erro(`${altas.length} folha(s) mais altas que a área útil`);

    // 5. UMA folha do documento = UMA página do PDF. Se o Chrome quebrou
    //    uma folha nossa em duas, a segunda é justamente a página quase
    //    vazia que a auditoria encontrou.
    if (medido.folhas && paginas.length !== medido.folhas)
      erro(`${medido.folhas} folha(s) viraram ${paginas.length} página(s) no PDF`);

    // 6. a numeração do documento bate com as páginas do PDF.
    const numeradas = paginas.filter((t) => /página \d+ de \d+/i.test(t)).length;
    if (numeradas !== paginas.length)
      erro(`${paginas.length - numeradas} página(s) sem numeração própria`);

    // 7. contagem esperada, quando o recorte tem número conhecido.
    if (esperado != null) {
      const encontradas = medido.vazio ? 0 : medido.linhas;
      if (encontradas !== esperado)
        erro(`esperava ${esperado} linha(s) no documento e encontrei ${encontradas}`);
      // Zero registros NÃO é documento em branco: a auditoria exige que o
      // vazio se declare (teste 18 antecipado, e é barato garantir aqui).
      if (esperado === 0 && !/nenhum registro/i.test(texto))
        erro("documento vazio não diz que está vazio");
    }

    resumo.push({
      relatorio: nome,
      orientacao: medido.orientacao,
      folhas: medido.folhas,
      paginasPdf: paginas.length,
      linhas: medido.vazio ? 0 : medido.linhas,
      colunas: ESSENCIAIS[chave].length,
      arquivo: saidaDir ? arquivo.replace(process.cwd() + "/", "") : "(temporário)",
    });
    log(
      `  ${falhas.some((f) => f.startsWith(nome)) ? "✖" : "✓"} ${nome.padEnd(30)} ` +
        `${String(medido.vazio ? 0 : medido.linhas).padStart(4)} linha(s) · ` +
        `${paginas.length} pág · ${medido.orientacao}`
    );
  }

  log("INTEGRIDADE DOS 18 RELATÓRIOS");
  for (const chave of relatorios) await conferir(chave, args.qs, null, null);

  if (!SO && !args.qs) {
    log("");
    log("TAMANHOS (teste 12) — mesmo relatório, de 0 a 130 registros");
    for (const t of TAMANHOS) await conferir("clientes", t.qs, t.rotulo, t.esperado);
  }

  await navegador.close();

  if (saidaDir) {
    writeFileSync(
      join(saidaDir, "_resumo.json"),
      JSON.stringify({ gerado: new Date().toISOString(), base: BASE, resumo, falhas }, null, 2)
    );
  }

  log("");
  if (falhas.length) {
    log(`✖ ${falhas.length} problema(s) de integridade:`);
    for (const f of falhas) log(`   · ${f}`);
    process.exit(1);
  }
  log(`✓ ${resumo.length} relatório(s) exportados com integridade`);
}

main().catch((e) => {
  console.error("falhou:", e);
  process.exit(1);
});
