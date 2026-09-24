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

describe('arquivos "use server"', () => {
  it("só exportam funções assíncronas", () => {
    const offenders: string[] = [];
    for (const file of listTs(SRC)) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["'];?/.test(src)) continue;
      // Remove comentários antes de procurar exports.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const re = /^export\s+(?!async\s+function\b)(?!type\b)(?!interface\b)(\w+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code))) {
        offenders.push(`${path.relative(SRC, file)}: export ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
