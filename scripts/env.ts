import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Loader leve de .env para os scripts (tsx não carrega .env sozinho).
 * Não sobrescreve variáveis já definidas no ambiente.
 */
export function loadEnv() {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] != null) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
