/**
 * BACKFILL DO RESPONSÁVEL COMERCIAL (Client.salesOwnerId → Employee).
 *
 * Para cada cliente com texto em "salesOwner" e sem vínculo (salesOwnerId
 * null), casa o nome digitado com um colaborador do MESMO dono (comparação
 * case-insensitive, sem espaços nas pontas). Sem correspondente, cria o
 * colaborador (type PJ, salário 0, ativo). Depois grava o vínculo e
 * normaliza o texto para o nome canônico do colaborador.
 *
 * Idempotente e re-executável (clientes já vinculados são ignorados) —
 * útil após importações ou bulk-updates que só escrevem o texto.
 *
 * Uso:
 *   npx tsx scripts/backfill-sales-owner.ts           (dry-run: só relata)
 *   APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx scripts/backfill-sales-owner.ts --apply
 *
 * Pré-requisito: migration 20260728000000_client_sales_owner_employee aplicada.
 */
import { loadEnv } from "./env";
import { assertDestructiveAllowed } from "./guard";
loadEnv();

const APPLY = process.argv.includes("--apply");
// Dry-run é leitura pura e não passa pela guarda; --apply escreve (03 §4.6).
if (APPLY) assertDestructiveAllowed({ script: "scripts/backfill-sales-owner.ts" });
const norm = (s: string) => s.trim().toLowerCase();

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");

  await runWithoutScope(async () => {
    const clients = await prisma.client.findMany({
      where: { salesOwner: { not: null }, salesOwnerId: null },
      select: { id: true, name: true, salesOwner: true, ownerId: true },
    });
    const employees = await prisma.employee.findMany({
      select: {
        id: true, name: true, active: true, createdAt: true, ownerId: true,
      },
    });

    console.log(
      `${APPLY ? "APLICANDO" : "DRY-RUN (nada será gravado; use --apply)"} — ` +
        `${clients.length} clientes com responsável em texto e sem vínculo.`
    );

    // Agrupa por (dono, nome normalizado) — nomes só fazem sentido por dono.
    const groups = new Map<string, { ownerId: string | null; text: string; clientIds: string[] }>();
    for (const c of clients) {
      const text = c.salesOwner!.trim();
      if (!text) continue;
      const key = `${c.ownerId ?? "__null__"}::${norm(text)}`;
      const g = groups.get(key) ?? { ownerId: c.ownerId, text, clientIds: [] };
      g.clientIds.push(c.id);
      groups.set(key, g);
    }

    let linked = 0, created = 0, ambiguous = 0;
    for (const g of [...groups.values()].sort((a, b) => a.text.localeCompare(b.text))) {
      const candidates = employees.filter(
        (e) => e.ownerId === g.ownerId && norm(e.name) === norm(g.text)
      );
      // Homônimos: prefere ativo; empate, o mais antigo. Sempre logado.
      if (candidates.length > 1) {
        ambiguous++;
        console.log(
          `  ! "${g.text}": ${candidates.length} colaboradores homônimos — ` +
            `usando o ${candidates.some((c) => c.active) ? "ativo" : ""} mais antigo.`
        );
      }
      let emp = candidates.sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )[0];

      if (!emp) {
        created++;
        console.log(
          `  + criar colaborador "${g.text}" (PJ, salário 0) → ${g.clientIds.length} cliente(s)`
        );
        if (APPLY) {
          emp = {
            ...(await prisma.employee.create({
              data: { name: g.text, type: "PJ", baseSalary: 0, active: true, ownerId: g.ownerId },
              select: { id: true, name: true, active: true, createdAt: true, ownerId: true },
            })),
          };
          employees.push(emp);
        }
      } else {
        console.log(
          `  = "${g.text}" → colaborador existente "${emp.name}"${emp.active ? "" : " (INATIVO)"} → ${g.clientIds.length} cliente(s)`
        );
      }
      linked += g.clientIds.length;

      if (APPLY && emp) {
        await prisma.client.updateMany({
          where: { id: { in: g.clientIds } },
          // Normaliza o texto para o nome canônico do colaborador.
          data: { salesOwnerId: emp.id, salesOwner: emp.name },
        });
      }
    }

    console.log(
      `\nResumo: ${linked} cliente(s) a vincular · ${created} colaborador(es) a criar · ` +
        `${ambiguous} nome(s) ambíguo(s).` +
        (APPLY ? " Aplicado." : " Nada gravado (dry-run).")
    );
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
