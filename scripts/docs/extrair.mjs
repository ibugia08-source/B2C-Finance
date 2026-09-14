/**
 * EXTRATOR DE FATOS DO CÓDIGO — base da documentação do B2C Finance.
 *
 * A documentação anterior foi escrita à mão em 29/08/2026 e envelheceu em
 * silêncio: descrevia reservas de caixa que saíram do produto em 10/09 e não
 * conhecia telas criadas depois. Documento que não é gerado do código volta a
 * mentir na primeira semana.
 *
 * Este módulo lê o código-fonte e devolve os FATOS — rotas, modelos,
 * permissões, métricas, relatórios, tokens. A narrativa (o porquê de cada
 * decisão) continua sendo escrita por gente, em scripts/docs/secoes/, e o
 * montador junta as duas coisas.
 *
 * Uso: node scripts/docs/gerar.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

export function arquivos(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivos(p, exts));
    else if (exts.some((e) => nome.endsWith(e))) out.push(p);
  }
  return out;
}

// O repositório mora no iCloud Drive e cada leitura pode custar dezenas de
// milissegundos. Vários extratores varrem os mesmos arquivos, então o cache
// de processo derruba a geração de minutos para segundos.
const _cache = new Map();
const ler = (p) => {
  if (_cache.has(p)) return _cache.get(p);
  const v = existsSync(p) ? readFileSync(p, "utf8") : "";
  _cache.set(p, v);
  return v;
};

/** Descarta as cópias " 2.ts" que o iCloud deixa para trás. */
const semDuplicata = (p) => !/ \d+\.(ts|tsx|mjs)$/.test(p);

// ===================================================================
// ROTAS
// ===================================================================
export function rotas() {
  const out = [];
  // A raiz não é subpasta de ninguém: entra à mão, senão `/` some do mapa.
  if (existsSync("src/app/page.tsx")) {
    const fonte = ler("src/app/page.tsx");
    out.push({
      rota: "/",
      arquivo: "src/app/page.tsx",
      permissao: fonte.match(/requirePagePermission\(\s*"([^"]+)"/)?.[1] ?? null,
      dinamica: /export const dynamic\s*=\s*"force-dynamic"/.test(fonte),
      proposito: propositoDe(fonte),
    });
  }
  (function anda(dir, rota) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (!statSync(p).isDirectory()) continue;
      if (nome === "api") continue;
      const proxima =
        nome.startsWith("(") && nome.endsWith(")") ? rota : `${rota}/${nome}`;
      if (existsSync(join(p, "page.tsx"))) {
        const fonte = ler(join(p, "page.tsx"));
        out.push({
          rota: proxima || "/",
          arquivo: join(p, "page.tsx"),
          permissao: fonte.match(/requirePagePermission\(\s*"([^"]+)"/)?.[1] ?? null,
          dinamica: /export const dynamic\s*=\s*"force-dynamic"/.test(fonte),
          // A primeira frase do comentário de topo é o propósito da tela.
          proposito: propositoDe(fonte),
        });
      }
      anda(p, proxima);
    }
  })("src/app", "");
  return out.sort((a, b) => a.rota.localeCompare(b.rota));
}

/** Primeira frase do bloco /** ... *\/ de topo, limpa. */
function propositoDe(fonte) {
  const m = fonte.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return null;
  const texto = m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*ic?\s?/, "").replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
  const frase = texto.split(/(?<=\.)\s/)[0];
  return frase && frase.length > 12 ? frase.trim() : null;
}

export function rotasDeApi() {
  return arquivos("src/app/api", ["route.ts"]).map((p) => ({
    rota: "/" + p.replace(/^src\/app\//, "").replace(/\/route\.ts$/, ""),
    metodos: [...ler(p).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)]
      .map((m) => m[1]),
  }));
}

// ===================================================================
// BANCO
// ===================================================================
export function modelos() {
  const s = ler("prisma/schema.prisma");
  const out = [];
  // O schema usa DOIS estilos: `///` (documentação do Prisma, 30 modelos) e
  // `//` (comentário comum, a maioria). Os dois explicam a tabela e os dois
  // entram. A contiguidade é o que evita capturar o comentário de um enum
  // que por acaso termina logo acima de um model.
  const re = /(?:^|\n)((?:\/\/\/?[^\n]*\n)*)model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(s))) {
    const doc = m[1]
      .split("\n").map((l) => l.replace(/^\/\/\/?\s?/, "").trim())
      .filter(Boolean).join(" ");
    const campos = [...m[3].matchAll(/^\s{2}(\w+)\s+([\w\[\]?]+)/gm)]
      .map((c) => ({ nome: c[1], tipo: c[2] }))
      .filter((c) => !["model", "enum"].includes(c.nome));
    out.push({ nome: m[2], doc: doc || null, campos, totalCampos: campos.length });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome));
}

export function enums() {
  const s = ler("prisma/schema.prisma");
  const out = [];
  const re = /(?:^|\n)((?:\/\/\/?[^\n]*\n)*)enum\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(s))) {
    out.push({
      nome: m[2],
      doc: m[1].split("\n").map((l) => l.replace(/^\/\/\/?\s?/, "").trim()).filter(Boolean).join(" ") || null,
      valores: m[3].split("\n").map((l) => l.trim()).filter((l) => /^\w+$/.test(l)),
    });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome));
}

export function migrations() {
  const dir = "prisma/migrations";
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^\d/.test(n))
    .sort()
    .map((n) => {
      const m = n.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(.+)$/);
      return m
        ? { data: `${m[3]}/${m[2]}/${m[1]}`, nome: m[7].replace(/_/g, " "), pasta: n }
        : { data: null, nome: n, pasta: n };
    });
}

// ===================================================================
// PERMISSÕES
// ===================================================================
export function permissoes() {
  const s = ler("src/lib/permissions.ts");
  const grupos = [];
  const re = /\{\s*(?:\/\/[^\n]*\n\s*)*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*permissions:\s*\[([\s\S]*?)\n\s*\],/g;
  let m;
  while ((m = re.exec(s))) {
    grupos.push({
      chave: m[1],
      label: m[2],
      permissoes: [...m[3].matchAll(/id:\s*"([^"]+)",\s*label:\s*"([^"]+)"(,\s*sensitive:\s*true)?/g)]
        .map((p) => ({ id: p[1], label: p[2], sensivel: !!p[3] })),
    });
  }
  // Papéis e o tamanho do conjunto de cada um.
  const bloco = s.slice(s.indexOf("ROLE_PERMISSIONS"));
  const papeis = [];
  // Três papéis declaram a lista em UMA linha (ADMIN: ["*"], LEITURA, USER) e
  // os demais em bloco. A alternativa de UMA LINHA vem primeiro de propósito:
  // a alternativa multilinha casa da abertura de ADMIN até o fechamento de
  // GESTOR e engole o papel do meio — o regex alterna na ordem escrita.
  const reP = /^  ([A-Z_]+):\s*(\[[^\]\n]*\]|\[[\s\S]*?\n  \]),/gm;
  let p;
  while ((p = reP.exec(bloco))) {
    const lista = p[2];
    papeis.push({
      papel: p[1],
      tudo: lista.includes('"*"'),
      quantidade: lista.includes('"*"') ? null : (lista.match(/"/g)?.length ?? 0) / 2,
    });
  }
  const descricoes = Object.fromEntries(
    [...s.matchAll(/^\s*([A-Z_]+):\s*"([^"]{20,})",$/gm)].map((d) => [d[1], d[2]])
  );
  return { grupos, papeis: papeis.map((x) => ({ ...x, descricao: descricoes[x.papel] ?? null })) };
}

// ===================================================================
// MÉTRICAS
// ===================================================================
export function metricas() {
  const s = ler("src/lib/metrics/registry.ts");
  // 45 campos apontam para constantes declaradas no topo (MOEDA, PCT, DIV0)
  // em vez de repetir o literal. Sem resolvê-las, o arredondamento e a
  // política de nulo saem vazios na documentação — justamente os campos que
  // dizem o que acontece quando a conta não fecha.
  const constantes = Object.fromEntries(
    [...s.matchAll(/^const (\w+) = "([^"]*)";$/gm)].map((m) => [m[1], m[2]])
  );
  const out = [];
  // `(?:\/\/[^\n]*\n\s*)*` deixa passar o comentário que explica por que a
  // métrica ganhou versão nova — sem isso, as entradas versionadas somem.
  const re = /\{\s*(?:\/\/[^\n]*\n\s*)*key:\s*"([^"]+)",([\s\S]*?)\n  \},/g;
  let m;
  while ((m = re.exec(s))) {
    const corpo = m[2];
    // Resolve tanto literal ("half-up, 2 casas") quanto referência a
    // constante (rounding: MOEDA) — 43 das 52 métricas usam a segunda forma,
    // e sem isso arredondamento e política de nulo saíam vazios.
    const campo = (nome) => {
      const literal = corpo.match(new RegExp(nome + ':\\s*\\n?\\s*"([^"]*)"'));
      if (literal) return literal[1];
      const ref = corpo.match(new RegExp(nome + ':\\s*([A-Z_][A-Z_0-9]*)\\b'));
      return ref ? (constantes[ref[1]] ?? ref[1]) : null;
    };
    out.push({
      chave: m[1],
      versao: Number(corpo.match(/version:\s*(\d+)/)?.[1] ?? 1),
      vigenteAte: campo("vigenteAte"),
      nome: campo("name"),
      descricao: campo("description"),
      formula: campo("formulaDescription"),
      grao: campo("grain"),
      base: campo("dateBasis"),
      origens: (corpo.match(/sourceEntities:\s*\[([^\]]*)\]/)?.[1] ?? "")
        .split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean),
      filtros: campo("filters"),
      arredondamento: campo("rounding"),
      nulo: campo("nullPolicy"),
      spec: campo("spec"),
    });
  }
  return out;
}

// ===================================================================
// RELATÓRIOS
// ===================================================================
export function relatorios() {
  return arquivos("src/lib/reports/definitions", [".ts"])
    .filter(semDuplicata)
    .map((p) => {
      const s = ler(p);
      return {
        arquivo: p,
        chave: s.match(/key:\s*"([^"]+)"/)?.[1] ?? null,
        titulo: s.match(/title:\s*"([^"]+)"/)?.[1] ?? null,
        descricao: s.match(/description:\s*"([^"]+)"/)?.[1] ?? null,
        colunas: [...s.matchAll(/\{\s*key:\s*"[^"]+",\s*label:\s*"([^"]+)"/g)].map((c) => c[1]),
      };
    })
    .filter((r) => r.chave)
    .sort((a, b) => (a.titulo ?? "").localeCompare(b.titulo ?? ""));
}

// ===================================================================
// SERVER ACTIONS E SERVICES
// ===================================================================
export function acoes() {
  return arquivos("src/lib/actions", [".ts"])
    .filter(semDuplicata)
    .map((p) => {
      const s = ler(p);
      return {
        arquivo: p,
        modulo: p.split("/").pop().replace(".ts", ""),
        funcoes: [...s.matchAll(/export async function (\w+)/g)].map((f) => f[1]),
        permissoes: [...new Set([...s.matchAll(/requirePermission\(\s*"([^"]+)"/g)].map((x) => x[1]))],
      };
    })
    .filter((a) => a.funcoes.length)
    .sort((a, b) => a.modulo.localeCompare(b.modulo));
}

export function services() {
  return arquivos("src/lib/services", [".ts"])
    .filter(semDuplicata)
    .map((p) => ({
      modulo: p.split("/").pop().replace(".ts", ""),
      proposito: propositoDe(ler(p)),
      exporta: [...ler(p).matchAll(/export (?:async )?function (\w+)|export const (\w+)\s*=/g)]
        .map((m) => m[1] ?? m[2]).filter(Boolean),
    }))
    .sort((a, b) => a.modulo.localeCompare(b.modulo));
}

// ===================================================================
// DESIGN
// ===================================================================
export function tokens() {
  const css = ler("src/app/globals.css");
  const pega = (bloco) => {
    const out = {};
    for (const m of bloco.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  };
  return {
    claro: pega(css.match(/:root\s*\{([\s\S]*?)\n  \}/)?.[1] ?? ""),
    escuro: pega(css.match(/\.dark\s*\{([\s\S]*?)\n  \}/)?.[1] ?? ""),
  };
}

export function componentes() {
  return arquivos("src/components", [".tsx"])
    .filter(semDuplicata)
    .map((p) => ({
      arquivo: p.replace("src/components/", ""),
      proposito: propositoDe(ler(p)),
      exporta: [...ler(p).matchAll(/export function (\w+)/g)].map((m) => m[1]),
    }))
    .filter((c) => c.exporta.length)
    .sort((a, b) => a.arquivo.localeCompare(b.arquivo));
}

// ===================================================================
// TESTES E AMBIENTE
// ===================================================================
export function testes() {
  return arquivos("tests", [".test.ts"]).map((p) => {
    const s = ler(p);
    return {
      arquivo: p.replace("tests/", ""),
      casos: (s.match(/\n\s*it\(/g) ?? []).length + (s.match(/\n\s*it\.each\(/g) ?? []).length,
      suites: [...s.matchAll(/describe\(\s*"([^"]+)"/g)].map((m) => m[1]),
      proposito: propositoDe(s),
    };
  }).sort((a, b) => a.arquivo.localeCompare(b.arquivo));
}

export function variaveisDeAmbiente() {
  const vistos = new Map();
  for (const p of [...arquivos("src", [".ts", ".tsx"]), ...arquivos("scripts", [".ts", ".mjs"])]) {
    for (const m of ler(p).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!vistos.has(m[1])) vistos.set(m[1], []);
      if (vistos.get(m[1]).length < 3) vistos.get(m[1]).push(p);
    }
  }
  const exemplo = ler(".env.example") + "\n" + ler(".env.production.example");
  const documentadas = new Set([...exemplo.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  return [...vistos.entries()]
    .map(([nome, usos]) => ({ nome, usos, documentada: documentadas.has(nome) }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

export function pacote() {
  const p = JSON.parse(ler("package.json"));
  return {
    nome: p.name,
    versao: p.version,
    scripts: p.scripts,
    dependencias: p.dependencies,
    desenvolvimento: p.devDependencies,
  };
}

export function navegacao() {
  const s = ler("src/components/nav-items.ts");
  const areas = [];
  const re = /\{\s*(?:\/\/[^\n]*\n\s*)*key:\s*"(\w+)",\s*\n?\s*label:\s*"([^"]+)",([\s\S]*?)\n    \],\s*\n  \}/g;
  let m;
  while ((m = re.exec(s))) {
    areas.push({
      chave: m[1],
      label: m[2],
      paginas: [...m[3].matchAll(/href:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*permission:\s*"([^"]+)"/g)]
        .map((p) => ({ href: p[1], label: p[2], permissao: p[3] })),
    });
  }
  return areas;
}

export function rotasAposentadas() {
  const s = ler("next.config.mjs");
  return [...s.matchAll(/\{\s*origem:\s*"([^"]+)",\s*destino:\s*"([^"]+)"\s*\}/g)]
    .map((m) => ({ origem: m[1], destino: m[2] }));
}
