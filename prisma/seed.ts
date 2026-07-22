import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN = {
  name: process.env.ADMIN_NAME ?? "Admin B2C Finance",
  email: process.env.ADMIN_EMAIL ?? "admin@b2cfinance.local",
  // Sem fallback: uma senha padrão publicada no repositório viraria
  // credencial conhecida em qualquer ambiente que rodasse o seed sem env.
  password: process.env.ADMIN_PASSWORD,
};

const PEOPLE = [
  { name: "Israel", type: "pessoal" },
  { name: "Isis", type: "familiar" },
  { name: "Esaú", type: "familiar" },
  { name: "Pai", type: "familiar" },
  { name: "Empresa / Agência", type: "empresa" },
  { name: "Terceiro", type: "terceiro" },
];

const CARDS = [
  { name: "Nubank Israel", bank: "Nubank", type: "pessoal", holder: "Israel", limitTotal: 5000, closingDay: 17, dueDay: 25 },
  { name: "Inter Israel", bank: "Inter", type: "pessoal", holder: "Israel", limitTotal: 3000, closingDay: 5, dueDay: 12 },
  { name: "C6 Bank", bank: "C6", type: "pessoal", holder: "Israel", limitTotal: 2000, closingDay: 10, dueDay: 18 },
  { name: "Will", bank: "Will Bank", type: "pessoal", holder: "Israel", limitTotal: 1500, closingDay: 20, dueDay: 28 },
  { name: "Magalu Esaú", bank: "Itaú", type: "terceiro", holder: "Esaú", limitTotal: 1000, closingDay: 1, dueDay: 8 },
  { name: "Magalu Israel", bank: "Itaú", type: "pessoal", holder: "Israel", limitTotal: 1500, closingDay: 1, dueDay: 8 },
  { name: "PicPay", bank: "PicPay", type: "pessoal", holder: "Israel", limitTotal: 800, closingDay: 22, dueDay: 30 },
  { name: "Sicredi", bank: "Sicredi", type: "pessoal", holder: "Israel", limitTotal: 2500, closingDay: 15, dueDay: 22 },
  { name: "Cartão do Pai", bank: "Bradesco", type: "terceiro", holder: "Pai", limitTotal: 4000, closingDay: 8, dueDay: 15 },
];

const CATEGORIES = [
  { name: "Pessoal", kind: "despesa", color: "#3b82f6" },
  { name: "Empresa", kind: "despesa", color: "#10b981" },
  { name: "Família", kind: "despesa", color: "#f59e0b" },
  { name: "Terceiros", kind: "despesa", color: "#a855f7" },
  { name: "Carro", kind: "despesa", color: "#ef4444" },
  { name: "Cabelo/Estética", kind: "despesa", color: "#ec4899" },
  { name: "Luz/Água", kind: "despesa", color: "#06b6d4" },
  { name: "Tráfego Pago", kind: "despesa", color: "#8b5cf6" },
  { name: "Ferramentas", kind: "despesa", color: "#64748b" },
  { name: "Alimentação", kind: "despesa", color: "#f97316" },
  { name: "Transporte", kind: "despesa", color: "#14b8a6" },
  { name: "Lazer", kind: "despesa", color: "#eab308" },
  { name: "Reserva de Emergência", kind: "mista", color: "#22c55e" },
  { name: "Investimentos", kind: "mista", color: "#16a34a" },
  { name: "Reembolsável", kind: "despesa", color: "#0ea5e9" },
  { name: "Dívida a Receber", kind: "despesa", color: "#dc2626" },
];

const RULES = [
  {
    name: "Tráfego Pago - META/ADS",
    priority: 10,
    descriptionContains: "META",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Tráfego Pago - Facebook",
    priority: 10,
    descriptionContains: "FACEBOOK",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Tráfego Pago - Google",
    priority: 10,
    descriptionContains: "GOOGLE",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Tráfego Pago - ADS",
    priority: 10,
    descriptionContains: "ADS",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Transporte - Uber",
    priority: 20,
    descriptionContains: "UBER",
    categoryName: "Transporte",
    belongsTo: "pessoal",
  },
  {
    name: "Carro - Posto",
    priority: 20,
    descriptionContains: "POSTO",
    categoryName: "Carro",
    belongsTo: "pessoal",
  },
  {
    name: "Luz/Água - COELBA",
    priority: 15,
    descriptionContains: "COELBA",
    categoryName: "Luz/Água",
    belongsTo: "pessoal",
  },
  {
    name: "Luz/Água - EMBASA",
    priority: 15,
    descriptionContains: "EMBASA",
    categoryName: "Luz/Água",
    belongsTo: "pessoal",
  },
];

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
