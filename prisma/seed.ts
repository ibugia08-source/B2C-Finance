import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PEOPLE, CARDS, CATEGORIES, RULES } from "./seed-data";

const prisma = new PrismaClient();

const ADMIN = {
  name: process.env.ADMIN_NAME ?? "Admin B2C Finance",
  email: process.env.ADMIN_EMAIL ?? "admin@b2cfinance.local",
  // Sem fallback: uma senha padrão publicada no repositório viraria
  // credencial conhecida em qualquer ambiente que rodasse o seed sem env.
  password: process.env.ADMIN_PASSWORD,
};

async function main() {
  console.log("→ Seed: usuário admin");
  let admin = await prisma.user.findUnique({ where: { email: ADMIN.email } });
  if (!admin) {
    if (!ADMIN.password) {
      throw new Error(
        "ADMIN_PASSWORD não definido. Defina a env var para criar o usuário admin do seed."
      );
    }
    const passwordHash = await bcrypt.hash(ADMIN.password, 10);
    admin = await prisma.user.create({
      data: {
        name: ADMIN.name,
        email: ADMIN.email,
        passwordHash,
        role: "ADMIN",
        active: true,
      },
    });
    console.log(`  ✓ admin criado: ${ADMIN.email}`);
  } else {
    console.log(`  • admin já existe: ${ADMIN.email}`);
  }
  const ownerId = admin.id;

  // IMPORTANTE: o seed é CREATE-ONLY — nunca sobrescreve dados existentes.
  // Multiusuário: entidades privadas (pessoas, cartões, regras) nascem
  // pertencendo ao admin (ownerId). Categorias são globais (compartilhadas).
  // Este script usa o PrismaClient CRU (sem a extensão), então o ownerId é
  // atribuído explicitamente.
  console.log("→ Seed: pessoas");
  for (const p of PEOPLE) {
    const exists = await prisma.person.findFirst({ where: { name: p.name, ownerId } });
    if (!exists) await prisma.person.create({ data: { ...p, ownerId } });
  }

  console.log("→ Seed: categorias (globais)");
  for (const c of CATEGORIES) {
    const exists = await prisma.category.findUnique({ where: { name: c.name } });
    if (!exists) await prisma.category.create({ data: c });
  }

  console.log("→ Seed: cartões");
  for (const c of CARDS) {
    const exists = await prisma.creditCard.findFirst({ where: { name: c.name, ownerId } });
    if (exists) continue;
    const holder = await prisma.person.findFirst({ where: { name: c.holder, ownerId } });
    await prisma.creditCard.create({
      data: {
        name: c.name,
        bank: c.bank,
        type: c.type,
        holderId: holder?.id,
        limitTotal: c.limitTotal,
        closingDay: c.closingDay,
        dueDay: c.dueDay,
        ownerId,
      },
    });
  }

  console.log("→ Seed: conta padrão");
  const existsAccount = await prisma.account.findFirst({
    where: { name: "Conta Principal", ownerId },
  });
  if (!existsAccount) {
    await prisma.account.create({
      data: { name: "Conta Principal", bank: "Inter", type: "corrente", balance: 0, ownerId },
    });
  }

  console.log("→ Seed: regras");
  for (const r of RULES) {
    const exists = await prisma.categorizationRule.findFirst({ where: { name: r.name, ownerId } });
    if (exists) continue;
    const cat = await prisma.category.findUnique({ where: { name: r.categoryName } });
    await prisma.categorizationRule.create({
      data: {
        name: r.name,
        priority: r.priority,
        descriptionContains: r.descriptionContains,
        categoryId: cat?.id,
        belongsTo: r.belongsTo,
        ownerId,
      },
    });
  }

  console.log("✓ Seed concluído");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
