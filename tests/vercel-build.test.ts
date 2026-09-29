import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { planoDeBuild, ultimaMigration } from "../scripts/vercel-build.mjs";

/**
 * BUILD DA VERCEL — publicação só de código (29/09/2026).
 * Sem variável: exatamente o build de sempre (migration + bootstrap).
 * Com B2C_SKIP_DB_STEPS = última migration: sem migration e sem bootstrap.
 * Qualquer outra coisa (1, nome errado, migration nova no commit): falha.
 */
const ULTIMA = ultimaMigration();
const cmd = (p: { passos: string[][] }) => p.passos.map((x) => x.join(" "));

describe("build da Vercel", () => {
  it("vercel.json chama npm run build, que chama o script", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(vercel.buildCommand).toBe("npm run build");
    expect(pkg.scripts.build).toBe("node scripts/vercel-build.mjs");
    expect(pkg.scripts["build:ci"]).toBe("prisma generate && next build");
  });

  it("sem variável: o mesmo build de antes (generate → migrate deploy → bootstrap → next build)", () => {
    expect(cmd(planoDeBuild({}, ULTIMA))).toEqual(["prisma generate", "prisma migrate deploy", "tsx prisma/bootstrap.ts", "next build"]);
    expect(cmd(planoDeBuild({ B2C_SKIP_DB_STEPS: "  " }, ULTIMA))).toContain("prisma migrate deploy");
  });

  it("com a última migration: só generate → next build (nem migration, nem bootstrap)", () => {
    const p = planoDeBuild({ B2C_SKIP_DB_STEPS: ULTIMA }, ULTIMA);
    expect(p.pulaBanco).toBe(true);
    expect(cmd(p)).toEqual(["prisma generate", "next build"]);
    expect(ULTIMA).toBe("20260929100000_messaging_identity_preferences");
  });

  it("recusa: valor que não é migration, migration anterior (commit trouxe migration nova) e migration inexistente", () => {
    expect(() => planoDeBuild({ B2C_SKIP_DB_STEPS: "1" }, ULTIMA)).toThrow(/não é nome de migration/);
    expect(() => planoDeBuild({ B2C_SKIP_DB_STEPS: "20260929091000_activity_source_telegram" }, ULTIMA)).toThrow(/migration nova/);
    expect(() => planoDeBuild({ B2C_SKIP_DB_STEPS: "20991231000000_futura" }, ULTIMA)).toThrow(/não existe/);
  });
});
