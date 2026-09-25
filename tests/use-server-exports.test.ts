import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * Arquivo "use server" só pode exportar função assíncrona. O Next registra
 * todo export como server action e, quando encontra um objeto, derruba o
 * módulo INTEIRO em tempo de execução — o build passa, tsc passa, o teste
 * da action passa, e a tela quebra em produção ("Nova conta" do Caixa,
 * 24/09/2026). Este teste lê o código-fonte e pega a classe de erro que
 * nenhum outro portão pega.
 */
function listTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) listTs(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SRC = path.resolve(__dirname, "..", "src");

/**
 * Devolve os exports proibidos de um código "use server" (já sem comentários).
 * Aceita: `export async function`, `export default async function`,
 * `export const|let|var f = async (…) =>`/`async function`/`async x =>`,
 * e exports só de tipo. Recusa todo o resto, inclusive as formas que não dá
 * para verificar lendo o arquivo: `export { x }`, `export { x } from`,
 * `export * from` (o alvo pode ser objeto/constante).
 */
export function forbiddenServerExports(code: string): string[] {
  const out: string[] = [];
  const re = /^[ \t]*export\b\s*([\s\S]{0,160})/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const rest = m[1];
    if (/^async\s+function\b/.test(rest)) continue;
    if (/^default\s+async\s+function\b/.test(rest)) continue;
    if (/^(type|interface)\b/.test(rest)) continue;
    if (/^declare\s+(type|interface)\b/.test(rest)) continue;
    if (/^type\s*\{/.test(rest)) continue;
    const decl = rest.match(
      /^(?:const|let|var)\s+\w+\s*(?::[^\n]*?)?=\s*async\s*(?:function\b|\(|\w+\s*=>)/
    );
    if (decl) continue;
    out.push("export " + rest.split("\n")[0].trim().slice(0, 60));
  }
  return out;
}

describe("forbiddenServerExports", () => {
  it("aceita funções assíncronas e tipos", () => {
    const ok = [
      "export async function a() {}",
      "export default async function b() {}",
      "export const c = async () => {};",
      "export const d = async (x: number) => x;",
      "export const e = async function () {};",
      "export const f: () => Promise<void> = async () => {};",
      "export const g = async x => x;",
      "export type T = string;",
      "export interface I { a: string }",
      "export type { T2 } from './x';",
    ];
    for (const code of ok) expect(forbiddenServerExports(code), code).toEqual([]);
  });
  it("recusa objetos, funções síncronas e reexports", () => {
    const bad = [
      "export const X = { a: 1 };",
      "export const f = () => 1;",
      "export function sync() {}",
      "export class C {}",
      "export enum E { A }",
      "export { x };",
      "export { x as y } from './z';",
      "export * from './z';",
      "export * as ns from './z';",
      "export default { a: 1 };",
    ];
    for (const code of bad) expect(forbiddenServerExports(code).length, code).toBe(1);
  });
});

describe('arquivos "use server"', () => {
  it("só exportam funções assíncronas", () => {
    const offenders: string[] = [];
    for (const file of listTs(SRC)) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["'];?/.test(src)) continue;
      // Remove comentários antes de procurar exports.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const o of forbiddenServerExports(code)) {
        offenders.push(`${path.relative(SRC, file)}: ${o}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
