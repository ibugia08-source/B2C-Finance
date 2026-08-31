import { fileURLToPath } from "url";
import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Suíte de proteção do B2C Finance (F0.2 — ref. 03 §4.5).
 *
 * Roda contra o banco de TESTES dedicado (b2c_finance_test), nunca contra
 * dev, staging ou produção: a URL é fixada aqui e sobrescreve o .env.
 * `npm run db:test:setup` prepara o banco.
 */
// Alias declarado à mão (o plugin vite-tsconfig-paths é ESM-only e não
// carrega neste config CJS). Espelha "@/*" do tsconfig.json.
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src");

export default defineConfig({
  resolve: { alias: { "@": src } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Testes de banco compartilham tabelas: um arquivo por vez evita
    // corrida entre fixtures (cada um já isola por dono, mas contagens
    // globais e o throttle em memória do ciclo são por processo).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      APP_ENV: "local",
      POSTGRES_PRISMA_URL:
        "postgres://b2cdev:b2cdev@127.0.0.1:55432/b2c_finance_test",
      POSTGRES_URL_NON_POOLING:
        "postgres://b2cdev:b2cdev@127.0.0.1:55432/b2c_finance_test",
      SESSION_SECRET: "test-secret-para-a-suite-de-protecao-32-chars",
    },
  },
});
