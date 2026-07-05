import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { createSessionToken } = await import("@/lib/auth/session");
  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, role: true } })
  );
  console.log("TOKEN=" + createSessionToken({ uid: admin!.id, role: admin!.role as any }));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
