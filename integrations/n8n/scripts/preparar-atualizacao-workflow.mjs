#!/usr/bin/env node
/**
 * PREPARA A ATUALIZAÇÃO DE UM WORKFLOW QUE JÁ EXISTE NA INSTÂNCIA (n8n 2.x),
 * sem criar outro e sem perder o que é da instância. NÃO acessa o n8n: lê
 * arquivos e escreve arquivos.
 *
 *   node integrations/n8n/scripts/preparar-atualizacao-workflow.mjs \
 *     --id p7O54hZQ4aGl3AKN \
 *     --atual ~/n8n-backup/p7O54hZQ4aGl3AKN.json \
 *     --novo integrations/n8n/workflows/b2c-finance-telegram-agent-readonly.json \
 *     --saida ~/n8n-atualizacao
 *
 * Entradas:
 *  · --atual: o workflow COMO ESTÁ na instância (GET /api/v1/workflows/{id}
 *    ou "Download" no editor). Traz o id, as credenciais REAIS (id + nome,
 *    nunca o segredo), os ids dos nós, o webhookId e os settings.
 *  · --novo: a versão do repositório (credenciais placeholder CONFIGURAR_*).
 *  · --base (padrão "auto"): a versão do repositório que foi importada antes.
 *    "auto" procura no histórico do git a que mais se parece com --atual.
 *
 * Merge por NOME de nó, em três vias (base → atual = o que a instância mudou;
 * base → novo = o que o repositório mudou):
 *  · nó igual na instância e na base → vai a versão NOVA;
 *  · nó customizado na instância e intocado no repositório → fica o da INSTÂNCIA;
 *  · nó customizado na instância E mudado no repositório → CONFLITO: para,
 *    mostra as diferenças e exige --resolver "<nó>=novo|atual";
 *  · nó que só existe na instância → para; --resolver "<nó>=manter|remover".
 * Sempre preservados da instância: id do workflow, nome, settings, id de cada
 * nó existente, webhookId, posição e as CREDENCIAIS (mapeadas por tipo).
 *
 * Saída (em --saida, que precisa ficar FORA do repositório — tem ids reais):
 *  · corpo-put.json   corpo para PUT /api/v1/workflows/{id}?publishIfActive=false
 *  · relatorio.md     o que muda, o que foi preservado, credenciais usadas
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PADROES } from "./check-secrets.mjs";

const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Chaves aceitas pelo PUT /workflows/{id} do n8n 2.39.7 (schema da API pública). */
export const CHAVES_DE_NO = [
  "id", "name", "webhookId", "disabled", "notesInFlow", "notes", "type", "typeVersion", "executeOnce",
  "alwaysOutputData", "retryOnFail", "maxTries", "waitBetweenTries", "continueOnFail", "onError", "position",
  "parameters", "credentials",
];
export const CHAVES_DE_SETTINGS = [
  "saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution",
  "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "binaryMode", "callerPolicy", "callerIds",
  "timeSavedMode", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags",
  "credentialResolverId",
];

/** O que define o COMPORTAMENTO de um nó (sem id, posição, credencial, anotação). */
function comportamento(no) {
  const campos = ["type", "typeVersion", "parameters", "onError", "alwaysOutputData", "disabled", "executeOnce", "retryOnFail", "maxTries", "waitBetweenTries", "continueOnFail"];
  const ordenar = (v) =>
    Array.isArray(v) ? v.map(ordenar)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]))
    : v;
  return JSON.stringify(ordenar(Object.fromEntries(campos.filter((c) => no[c] !== undefined).map((c) => [c, no[c]]))));
}

/** Caminhos de parâmetro que diferem (para o relatório). */
function diferencas(a, b, pref = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diferencas(a[k], b[k], pref ? `${pref}.${k}` : k));
  }
  return [pref || "(raiz)"];
}

const porNome = (wf) => new Map(wf.nodes.map((n) => [n.name, n]));

/** Versões do arquivo no git (mais nova primeiro). */
function versoesNoGit(caminho) {
  const rel = relative(RAIZ_REPO, resolve(caminho));
  const shas = execFileSync("git", ["log", "--format=%H", "--", rel], { cwd: RAIZ_REPO, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  return shas.map((sha) => {
    try {
      return { sha, wf: JSON.parse(execFileSync("git", ["show", `${sha}:${rel}`], { cwd: RAIZ_REPO, encoding: "utf8", maxBuffer: 64 << 20 })) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** A versão do repositório mais parecida com a da instância (nós com comportamento idêntico). */
export function escolherBase(atual, candidatas) {
  const a = porNome(atual);
  let melhor = null;
  for (const c of candidatas) {
    const iguais = c.wf.nodes.filter((n) => a.has(n.name) && comportamento(a.get(n.name)) === comportamento(n)).length;
    const nota = iguais / Math.max(c.wf.nodes.length, a.size);
    if (!melhor || nota > melhor.nota) melhor = { ...c, iguais, nota };
  }
  return melhor;
}

/**
 * Merge puro (testável). Devolve { corpo, relatorio, conflitos, pendencias }.
 * `resolver`: { "<nó>": "novo" | "atual" | "manter" | "remover" }.
 *
 * @param {{ atual: any, base: any, novo: any, resolver?: Record<string, string>, idEsperado?: string }} p
 */
export function mesclar({ atual, base, novo, resolver = {}, idEsperado }) {
  if (idEsperado && atual.id !== idEsperado) {
    throw new Error(`O arquivo --atual é do workflow ${atual.id}, não de ${idEsperado}. Exporte o workflow certo.`);
  }
  const A = porNome(atual);
  const B = porNome(base);
  const N = porNome(novo);
  const conflitos = [];
  const pendencias = [];
  const linhas = [];
  const nos = [];

  // Credenciais da instância por tipo (para nós novos): tem de ser uma só por tipo.
  const credPorTipo = new Map();
  for (const n of atual.nodes) {
    for (const [tipo, ref] of Object.entries(n.credentials ?? {})) {
      const set = credPorTipo.get(tipo) ?? new Map();
      set.set(ref.id, ref);
      credPorTipo.set(tipo, set);
    }
  }

  for (const nn of novo.nodes) {
    const na = A.get(nn.name);
    const nb = B.get(nn.name);
    let escolhido = nn;
    let origem = "novo";
    if (na) {
      const instanciaMudou = !nb || comportamento(na) !== comportamento(nb);
      const repoMudou = !nb || comportamento(nn) !== comportamento(nb);
      if (instanciaMudou && !repoMudou) {
        escolhido = na;
        origem = "atual (customização da instância preservada)";
      } else if (instanciaMudou && repoMudou && comportamento(na) !== comportamento(nn)) {
        const r = resolver[nn.name];
        if (r === "atual") { escolhido = na; origem = "atual (--resolver)"; }
        else if (r === "novo") { origem = "novo (--resolver)"; }
        else {
          conflitos.push({ no: nn.name, instancia: diferencas(nb?.parameters, na.parameters, "parameters"), repositorio: diferencas(nb?.parameters, nn.parameters, "parameters") });
          continue;
        }
      }
    }
    // Credenciais: as da instância (por tipo), nunca o placeholder.
    const credenciais = {};
    for (const tipo of Object.keys(escolhido.credentials ?? nn.credentials ?? {})) {
      const daInstancia = na?.credentials?.[tipo];
      if (daInstancia) { credenciais[tipo] = { id: daInstancia.id, name: daInstancia.name }; continue; }
      const opcoes = [...(credPorTipo.get(tipo)?.values() ?? [])];
      if (opcoes.length === 1) credenciais[tipo] = { id: opcoes[0].id, name: opcoes[0].name };
      else pendencias.push(`${nn.name}: ${opcoes.length === 0 ? "nenhuma" : "mais de uma"} credencial do tipo ${tipo} na instância — escolha no editor depois.`);
    }
    const saida = {};
    for (const k of CHAVES_DE_NO) if (escolhido[k] !== undefined) saida[k] = escolhido[k];
    saida.name = nn.name;
    saida.id = na?.id ?? randomUUID();
    if (na?.webhookId) saida.webhookId = na.webhookId;
    if (na?.position) saida.position = na.position;
    if (Object.keys(credenciais).length) saida.credentials = credenciais;
    else delete saida.credentials;
    nos.push(saida);
    const status = !na ? "NOVO" : comportamento(na) === comportamento(saida) ? "igual" : "ALTERADO";
    linhas.push(`| ${nn.name} | ${status} | ${origem} |`);
  }

  // Nós que só a instância tem.
  for (const na of atual.nodes) {
    if (N.has(na.name)) continue;
    const r = resolver[na.name];
    if (B.has(na.name) && r !== "manter") { linhas.push(`| ${na.name} | REMOVIDO | saiu do repositório |`); continue; }
    if (r === "manter") {
      const saida = {};
      for (const k of CHAVES_DE_NO) if (na[k] !== undefined) saida[k] = na[k];
      nos.push(saida);
      linhas.push(`| ${na.name} | mantido | só na instância (--resolver) |`);
    } else if (r === "remover") {
      linhas.push(`| ${na.name} | REMOVIDO | só na instância (--resolver) |`);
    } else {
      conflitos.push({ no: na.name, instancia: ["nó existe só na instância"], repositorio: [] });
    }
  }

  // Conexões: as do repositório + as dos nós mantidos da instância.
  const nomes = new Set(nos.map((n) => n.name));
  const connections = JSON.parse(JSON.stringify(novo.connections));
  for (const [origemNo, saidas] of Object.entries(atual.connections ?? {})) {
    if (!nomes.has(origemNo) || resolver[origemNo] !== "manter") continue;
    connections[origemNo] = saidas;
  }
  for (const [origemNo, saidas] of Object.entries(connections)) {
    for (const lista of Object.values(saidas)) for (const ramo of lista) for (const c of ramo ?? []) {
      if (!nomes.has(c.node)) pendencias.push(`Conexão ${origemNo} → ${c.node}: destino não existe.`);
    }
  }

  const settingsDescartados = Object.keys(atual.settings ?? {}).filter((k) => !CHAVES_DE_SETTINGS.includes(k));
  const settings = Object.fromEntries(Object.entries(atual.settings ?? {}).filter(([k]) => CHAVES_DE_SETTINGS.includes(k)));
  const corpo = { name: atual.name, nodes: nos, connections, settings };

  // Nada de segredo no corpo (credenciais só como referência id+nome).
  const texto = JSON.stringify(corpo);
  for (const p of PADROES.filter((x) => x.nome !== "id de credencial real")) {
    if (p.re.test(texto)) throw new Error(`O corpo gerado parece conter ${p.nome}. Nada foi gravado.`);
  }
  if (/CONFIGURAR_[A-Z0-9_]+/.test(JSON.stringify(nos.map((n) => n.credentials ?? {})))) {
    pendencias.push("Ainda há credencial placeholder CONFIGURAR_* — ligue no editor antes de publicar.");
  }

  const relatorio = [
    `# Atualização do workflow ${atual.id} — ${atual.name}`,
    "",
    `- Nós: ${atual.nodes.length} na instância → ${nos.length} no corpo.`,
    `- Settings preservados da instância: ${Object.keys(settings).join(", ") || "(nenhum)"}${settingsDescartados.length ? `; descartados (a API não aceita): ${settingsDescartados.join(", ")}` : ""}.`,
    `- Credenciais usadas (id · nome): ${[...new Set(nos.flatMap((n) => Object.entries(n.credentials ?? {}).map(([t, r]) => `${t}: ${r.id} · ${r.name}`)))].join("; ")}.`,
    `- Versão publicada antes (para voltar): ${atual.activeVersionId ?? atual.activeVersion?.versionId ?? "(não informada no export)"}.`,
    "",
    "| Nó | Situação | Origem |",
    "|---|---|---|",
    ...linhas,
    "",
    ...(pendencias.length ? ["## Pendências", ...pendencias.map((p) => `- ${p}`), ""] : []),
    ...(conflitos.length
      ? ["## CONFLITOS (nada gravado)", ...conflitos.map((c) => `- **${c.no}** — instância mudou: ${c.instancia.join(", ") || "—"}; repositório mudou: ${c.repositorio.join(", ") || "—"}. Use --resolver "${c.no}=novo" ou "=atual".`), ""]
      : []),
  ].join("\n");
  return { corpo, relatorio, conflitos, pendencias };
}

function args(argv) {
  const out = { resolver: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--resolver") {
      const [no, acao] = argv[++i].split("=");
      out.resolver[no] = acao;
    } else if (k.startsWith("--")) out[k.slice(2)] = argv[++i];
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = args(process.argv.slice(2));
  for (const obrig of ["id", "atual", "novo", "saida"]) {
    if (!a[obrig]) { console.error(`Falta --${obrig}. Veja o cabeçalho deste script.`); process.exit(2); }
  }
  const saida = resolve(a.saida);
  if (!relative(RAIZ_REPO, saida).startsWith("..")) {
    console.error("--saida precisa ficar FORA do repositório (o corpo tem ids reais da instância)."); process.exit(2);
  }
  const atual = JSON.parse(readFileSync(a.atual, "utf8"));
  const novo = JSON.parse(readFileSync(a.novo, "utf8"));
  let base;
  if (!a.base || a.base === "auto") {
    const b = escolherBase(atual, versoesNoGit(a.novo));
    if (!b) { console.error("Não achei versões do arquivo no git."); process.exit(2); }
    console.log(`Base: commit ${b.sha.slice(0, 7)} (${b.iguais} nós idênticos aos da instância).`);
    base = b.wf;
  } else base = JSON.parse(readFileSync(a.base, "utf8"));
  const r = mesclar({ atual, base, novo, resolver: a.resolver, idEsperado: a.id });
  mkdirSync(saida, { recursive: true });
  writeFileSync(join(saida, "relatorio.md"), r.relatorio + "\n");
  console.log(r.relatorio);
  if (r.conflitos.length) { console.error(`\n✖ ${r.conflitos.length} conflito(s): corpo NÃO gerado.`); process.exit(1); }
  writeFileSync(join(saida, "corpo-put.json"), JSON.stringify(r.corpo, null, 2) + "\n");
  console.log(`\n✓ ${join(saida, "corpo-put.json")}${r.pendencias.length ? ` (com ${r.pendencias.length} pendência(s) — veja o relatório)` : ""}`);
}
