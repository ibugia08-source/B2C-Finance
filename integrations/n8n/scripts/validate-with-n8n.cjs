#!/usr/bin/env node
/**
 * Valida os workflows contra as DEFINIÇÕES REAIS dos nós de uma instalação
 * do n8n (não precisa de servidor rodando):
 *   · o tipo do nó existe;
 *   · a typeVersion é suportada;
 *   · cada parâmetro de primeiro nível existe na descrição daquela versão;
 *   · cada credencial usada é aceita pelo nó.
 *
 *   N8N_MODULES=/caminho/para/node_modules node integrations/n8n/scripts/validate-with-n8n.cjs
 *
 * (N8N_MODULES = a pasta node_modules onde o pacote `n8n` está instalado.)
 */
const fs = require("fs");
const path = require("path");

const MOD = process.env.N8N_MODULES;
if (!MOD) {
  console.error("Defina N8N_MODULES com a pasta node_modules da instalação do n8n.");
  process.exit(2);
}

const PACOTES = [
  { pasta: "n8n-nodes-base", prefixo: "n8n-nodes-base." },
  { pasta: "@n8n/n8n-nodes-langchain", prefixo: "@n8n/n8n-nodes-langchain." },
];

function carregar(tiposUsados) {
  const tipos = new Map();
  for (const p of PACOTES) {
    const raiz = path.join(MOD, p.pasta);
    const manifesto = require(path.join(raiz, "package.json"));
    for (const rel of manifesto.n8n.nodes) {
      const base = path.basename(rel).replace(".node.js", "");
      // Só carrega os arquivos que podem conter os nós usados (mais rápido).
      const candidato = [...tiposUsados].some((t) => t.startsWith(p.prefixo) && base.toLowerCase() === t.slice(p.prefixo.length).toLowerCase());
      if (!candidato) continue;
      const mod = require(path.join(raiz, rel));
      for (const Classe of Object.values(mod)) {
        if (typeof Classe !== "function") continue;
        let inst;
        try { inst = new Classe(); } catch { continue; }
        const desc = inst.description ?? inst.baseDescription;
        if (!desc?.name) continue;
        const versoes = {};
        if (inst.nodeVersions) {
          for (const [v, n] of Object.entries(inst.nodeVersions)) versoes[v] = n.description;
        } else {
          const vs = Array.isArray(desc.version) ? desc.version : [desc.version ?? 1];
          for (const v of vs) versoes[String(v)] = desc;
        }
        tipos.set(p.prefixo + desc.name, versoes);
      }
    }
  }
  return tipos;
}

/** O tipo de credencial existe em algum pacote e define `authenticate`? */
function credencialAutentica(nome) {
  for (const p of PACOTES) {
    const raiz = path.join(MOD, p.pasta);
    const manifesto = require(path.join(raiz, "package.json"));
    for (const rel of manifesto.n8n.credentials ?? []) {
      const base = path.basename(rel).replace(".credentials.js", "");
      if (base.toLowerCase() !== nome.toLowerCase()) continue;
      for (const Classe of Object.values(require(path.join(raiz, rel)))) {
        if (typeof Classe !== "function") continue;
        try {
          const inst = new Classe();
          if (inst.name === nome) return !!inst.authenticate;
        } catch { /* segue */ }
      }
    }
  }
  return false;
}

function validar(arquivo, tipos) {
  const wf = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const problemas = [];
  for (const n of wf.nodes) {
    const versoes = tipos.get(n.type);
    if (!versoes) { problemas.push(`${n.name}: tipo desconhecido ${n.type}`); continue; }
    const desc = versoes[String(n.typeVersion)];
    if (!desc) { problemas.push(`${n.name}: typeVersion ${n.typeVersion} não suportada (${Object.keys(versoes).join(", ")})`); continue; }
    const nomes = new Set((desc.properties ?? []).map((p) => p.name));
    for (const k of Object.keys(n.parameters ?? {})) {
      if (!nomes.has(k)) problemas.push(`${n.name}: parâmetro "${k}" não existe em ${n.type}@${n.typeVersion}`);
    }
    const credsAceitas = new Set((desc.credentials ?? []).map((c) => c.name));
    for (const c of Object.keys(n.credentials ?? {})) {
      // httpHeaderAuth é credencial genérica (genericCredentialType), aceita por qualquer nó HTTP.
      if (c === "httpHeaderAuth") continue;
      // HTTP Request com credencial PRÉ-DEFINIDA: vale a do nodeCredentialType,
      // se o tipo existe e sabe se autenticar sozinho (propriedade `authenticate`).
      if (n.type === "n8n-nodes-base.httpRequest" && n.parameters?.authentication === "predefinedCredentialType") {
        if (n.parameters.nodeCredentialType !== c) problemas.push(`${n.name}: credencial "${c}" ≠ nodeCredentialType "${n.parameters.nodeCredentialType}"`);
        else if (!credencialAutentica(c)) problemas.push(`${n.name}: credencial "${c}" não existe ou não tem "authenticate" (não serve para HTTP Request)`);
        continue;
      }
      if (!credsAceitas.has(c)) problemas.push(`${n.name}: credencial "${c}" não aceita por ${n.type}`);
    }
  }
  return problemas;
}

const pasta = path.join(__dirname, "..", "workflows");
const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith(".json")).map((f) => path.join(pasta, f));
const usados = new Set(arquivos.flatMap((a) => JSON.parse(fs.readFileSync(a, "utf8")).nodes.map((n) => n.type)));
const tipos = carregar(usados);
const versaoN8n = require(path.join(MOD, "n8n", "package.json")).version;
let total = 0;
for (const a of arquivos) {
  const p = validar(a, tipos);
  total += p.length;
  console.log(`${path.basename(a)}: ${p.length ? p.length + " problema(s)" : "ok"} (n8n ${versaoN8n})`);
  for (const x of p) console.log("  - " + x);
}
process.exit(total ? 1 : 0);
