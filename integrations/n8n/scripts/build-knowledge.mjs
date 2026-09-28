#!/usr/bin/env node
/**
 * Gera o PACOTE DA BASE DE CONHECIMENTO do agente a partir dos documentos
 * listados em knowledge/manifest.json:
 *
 *   node integrations/n8n/scripts/build-knowledge.mjs   (parte do npm run n8n:build)
 *
 * Saída: knowledge/b2c-finance-knowledge.json — documentos + trechos prontos
 * para indexar (texto + metadados). A API serve este arquivo em
 * GET /api/v1/knowledge/documents e o workflow knowledge-ingest.json o indexa
 * no vector store (docs/AI_AGENT_KNOWLEDGE.md).
 *
 * Princípio: RAG = conhecimento e documentação; API = dados atuais. Por isso
 * o gerador RECUSA documento sem o cabeçalho `rag: true` + `dados_atuais: nao`
 * e qualquer trecho com cara de segredo. O teste confere que o pacote
 * versionado é exatamente o que este script gera.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PADROES } from "./check-secrets.mjs";

const RAIZ_N8N = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ_REPO = join(RAIZ_N8N, "..", "..");

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Cabeçalho YAML simples (chave: valor) → objeto + corpo sem ele. */
export function lerCabecalho(texto, caminho) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${caminho}: sem cabeçalho (--- rag: true … ---).`);
  const meta = Object.fromEntries(
    m[1].split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );
  if (meta.rag !== "true") throw new Error(`${caminho}: cabeçalho sem "rag: true".`);
  if (meta.dados_atuais !== "nao") {
    throw new Error(`${caminho}: a base de conhecimento só aceita documento com "dados_atuais: nao" (dados atuais vêm da API).`);
  }
  for (const k of ["titulo", "categoria", "atualizado_em"]) {
    if (!meta[k]) throw new Error(`${caminho}: cabeçalho sem "${k}".`);
  }
  return { meta, corpo: texto.slice(m[0].length) };
}

/**
 * Seções por título (## e ###), ignorando "#" dentro de bloco de código.
 * Cada seção: caminho de títulos + linhas.
 */
export function secoes(corpo) {
  const out = [];
  let atual = { h1: null, h2: null, h3: null, linhas: [] };
  let emCodigo = false;
  const fechar = () => {
    if (atual.linhas.join("\n").trim()) out.push(atual);
  };
  for (const linha of corpo.split("\n")) {
    if (/^```/.test(linha.trim())) emCodigo = !emCodigo;
    const h = !emCodigo && linha.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      fechar();
      const nivel = h[1].length;
      const titulo = h[2].trim();
      atual = {
        h1: nivel === 1 ? titulo : atual.h1,
        h2: nivel === 2 ? titulo : nivel === 1 ? null : atual.h2,
        h3: nivel === 3 ? titulo : null,
        linhas: [],
      };
      continue;
    }
    atual.linhas.push(linha);
  }
  fechar();
  return out;
}

/** Quebra um texto em partes ≤ max, por parágrafo (nunca no meio de um bloco de código). */
export function partir(texto, max) {
  const blocos = [];
  let buf = [];
  let emCodigo = false;
  for (const linha of texto.split("\n")) {
    if (/^```/.test(linha.trim())) emCodigo = !emCodigo;
    buf.push(linha);
    if (!emCodigo && linha.trim() === "") {
      blocos.push(buf.join("\n"));
      buf = [];
    }
  }
  if (buf.length) blocos.push(buf.join("\n"));
  // Bloco maior que o limite (tabela ou lista longa sem linha em branco):
  // quebra por linha, repetindo o cabeçalho da tabela em cada pedaço.
  const cabem = blocos.flatMap((b) => {
    if (b.length <= max || /^```/.test(b.trim())) return [b];
    const linhas = b.split("\n");
    const tabela = linhas.findIndex((l) => /^\|.*\|\s*$/.test(l));
    const cab = tabela >= 0 && /^\|[\s|:-]+\|\s*$/.test(linhas[tabela + 1] ?? "") ? linhas.slice(0, tabela + 2) : [];
    const resto = linhas.slice(cab.length);
    const pedacos = [];
    let atual = [...cab];
    for (const l of resto) {
      if (atual.length > cab.length && [...atual, l].join("\n").length > max) {
        pedacos.push(atual.join("\n"));
        atual = [...cab];
      }
      atual.push(l);
    }
    if (atual.length > cab.length) pedacos.push(atual.join("\n"));
    return pedacos.map((x) => x + "\n");
  });
  const partes = [];
  let acc = "";
  for (const b of cabem) {
    if (acc && (acc + b).length > max) {
      partes.push(acc);
      acc = "";
    }
    acc += b + (b.endsWith("\n") ? "" : "\n");
  }
  if (acc.trim()) partes.push(acc);
  return partes.map((p) => p.trim()).filter(Boolean);
}

export function gerarPacote(raizRepo = RAIZ_REPO) {
  const manifest = JSON.parse(readFileSync(join(RAIZ_N8N, "knowledge/manifest.json"), "utf8"));
  const documentos = [];
  const trechos = [];
  for (const d of manifest.documents) {
    if (manifest.neverIndex.paths.includes(d.path)) throw new Error(`${d.path} está em neverIndex.`);
    const bruto = readFileSync(join(raizRepo, d.path), "utf8");
    const { meta, corpo } = lerCabecalho(bruto, d.path);
    const excluir = d.excludeSections ?? [];
    let n = 0;
    for (const s of secoes(corpo)) {
      if ([s.h2, s.h3].some((t) => t && excluir.some((e) => t.startsWith(e)))) continue;
      const secao = [s.h2, s.h3].filter(Boolean).join(" › ") || "Introdução";
      for (const parte of partir(s.linhas.join("\n"), manifest.chunking.maxChars)) {
        n += 1;
        const text = `[Conhecimento B2C Finance — conceito/regra, não dado atual]\nDocumento: ${meta.titulo}\nSeção: ${secao}\n\n${parte}`;
        for (const p of PADROES) {
          if (p.re.test(text)) throw new Error(`${d.path} (${secao}): parece conter ${p.nome}.`);
        }
        trechos.push({
          id: `${d.id}#${String(n).padStart(3, "0")}`,
          text,
          metadata: {
            docId: d.id,
            titulo: meta.titulo,
            categoria: meta.categoria,
            secao,
            fonte: d.path,
            atualizado_em: meta.atualizado_em,
            tipo: "conhecimento",
          },
        });
      }
    }
    documentos.push({
      id: d.id,
      path: d.path,
      titulo: meta.titulo,
      categoria: meta.categoria,
      atualizado_em: meta.atualizado_em,
      sha256: sha(bruto),
      trechos: n,
    });
  }
  const conteudo = { documentos, trechos };
  return {
    catalog: manifest.catalog,
    version: `${manifest.version}+${sha(JSON.stringify(conteudo)).slice(0, 12)}`,
    principle: manifest.principle,
    collection: manifest.collection,
    embedding: manifest.embedding,
    ...conteudo,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pacote = gerarPacote();
  writeFileSync(join(RAIZ_N8N, "knowledge/b2c-finance-knowledge.json"), JSON.stringify(pacote, null, 2) + "\n");
  console.log(`Base de conhecimento: ${pacote.documentos.length} documentos, ${pacote.trechos.length} trechos (versão ${pacote.version}).`);
}
