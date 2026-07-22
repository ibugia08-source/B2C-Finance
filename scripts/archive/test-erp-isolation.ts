/**
 * Teste (temporário) do isolamento por ownerId nos novos modelos do ERP.
 * Uso: npx tsx scripts/test-erp-isolation.ts
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  // Importa pelos MESMOS especificadores usados no app (alias @/) para
  // compartilhar a mesma instância do AsyncLocalStorage do owner-scope.
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");

  const users = await runWithoutScope(() =>
    prisma.user.findMany({ select: { id: true }, take: 2 })
  );
  const [a, b] = users.map((u) => u.id);
  console.log("0. users:", users.length, "| a =", a, "| b =", b);

  // 1. Cria um Service como dono A (ownerId deve ser injetado)
  const svc = await runWithOwner(a, async () =>
    prisma.service.create({
      data: { name: "__teste_isolamento__", defaultPrice: 1500.5 },
    })
  );
  console.log(
    "1. ownerId injetado:",
    svc.ownerId === a ? "OK" : `FALHA (${svc.ownerId})`
  );

  // 2. Dono B não deve ver
  const viewB = await runWithOwner(b, async () =>
    prisma.service.findMany({ where: { name: "__teste_isolamento__" } })
  );
  console.log("2. dono B isolado:", viewB.length === 0 ? "OK" : "FALHA-VAZAMENTO");

  // 3. Dono A vê
  const viewA = await runWithOwner(a, async () =>
    prisma.service.findMany({ where: { name: "__teste_isolamento__" } })
  );
  console.log("3. dono A enxerga:", viewA.length === 1 ? "OK" : "FALHA");

  // 4. Decimal preservado
  console.log(
    "4. decimal:",
    String(viewA[0]?.defaultPrice) === "1500.5" ? "OK (1500.5)" : `FALHA (${viewA[0]?.defaultPrice})`
  );

  // 5. Limpeza
  await runWithoutScope(async () =>
    prisma.service.deleteMany({ where: { name: "__teste_isolamento__" } })
  );
  console.log("5. limpeza: OK");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});
