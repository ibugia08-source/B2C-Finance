import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CATEGORIES, RULES } from "./seed-data";

/**
 * SEED DE DESENVOLVIMENTO — deixa o sistema pronto para uso, sem NENHUM dado
 * de negócio.
 *
 * Cria apenas:
 *  - o usuário administrador (para conseguir logar);
 *  - as categorias globais e as regras de categorização (configuração).
 *
 * NÃO cria: clientes, contratos, cobranças, pagamentos, receitas, despesas,
 * pessoas, cartões, colaboradores, folha ou caixa. Nada disso.
 *
 * TRAVA DE SEGURANÇA: se o banco alvo já tiver dados de negócio, o script
 * ABORTA — é o sinal de que o .env está apontando para produção. Rodar mesmo
 * assim exige --forcar E a guarda oficial (APP_ENV + ALLOW_DESTRUCTIVE=true),
 * que recusa produção por conta própria.
 *
 * Uso: npm run db:seed:dev
 */

const prisma = new PrismaClient();

const ADMIN = {
  name: process.env.ADMIN_NAME ?? "Admin B2C Finance",
  email: process.env.ADMIN_EMAIL ?? "admin@b2cfinance.local",
  // Sem fallback: senha padrão no repositório viraria credencial conhecida.
  password: process.env.ADMIN_PASSWORD,
};

/** Máscara da URL do banco para o log (nunca imprime a senha). */
function targetLabel(): string {
  const url = process.env.POSTGRES_PRISMA_URL ?? "";
  const m = url.match(/@([^/:]+)/);
  const ref = url.match(/postgres\.([a-z0-9]+)/);
  return `${ref ? ref[1] : "?"} @ ${m ? m[1] : "?"}`;
}

async function assertEmpty(force: boolean) {
  const [clients, billings, transactions, incomes, contracts] = await Promise.all([
    prisma.client.count(),
    prisma.billing.count(),
    prisma.transaction.count(),
    prisma.income.count(),
    prisma.contract.count(),
  ]);
  const total = clients + billings + transactions + incomes + contracts;
  if (total === 0) return;

  const detalhe = `clientes=${clients} cobranças=${billings} despesas/transações=${transactions} receitas=${incomes} contratos=${contracts}`;
  if (!force) {
    console.error(
      [
        "",
        "⛔ ABORTADO — este banco JÁ TEM DADOS DE NEGÓCIO.",
        `   Alvo: ${targetLabel()}`,
        `   Encontrado: ${detalhe}`,
        "",
        "   O seed de desenvolvimento só roda em banco vazio. Isso quase sempre",
        "   significa que o .env está apontando para o banco de PRODUÇÃO.",
        "   Confira POSTGRES_PRISMA_URL antes de tentar de novo.",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
  // --forcar sem a guarda seria um wipe disfarçado: em banco com dados,
  // seguir escrevendo é decisão destrutiva e passa pela porta única de 03 §4.6.
  const { assertDestructiveAllowed } = await import("../scripts/guard");
  assertDestructiveAllowed({ script: "prisma/seed-dev.ts --forcar" });
  console.warn(`⚠️  --forcar: seguindo mesmo com dados existentes (${detalhe})`);
}

async function main() {
  const force = process.argv.includes("--forcar");
  console.log(`→ Banco alvo: ${targetLabel()}`);

  await assertEmpty(force);

  // ---- Administrador -------------------------------------------------
  console.log("→ Usuário administrador");
  let admin = await prisma.user.findUnique({ where: { email: ADMIN.email } });
  if (!admin) {
    if (!ADMIN.password) {
      throw new Error(
        "ADMIN_PASSWORD não definido. Defina a env var para criar o usuário admin."
      );
    }
    admin = await prisma.user.create({
      data: {
        name: ADMIN.name,
        email: ADMIN.email,
        passwordHash: await bcrypt.hash(ADMIN.password, 10),
        role: "ADMIN",
        active: true,
      },
    });
    console.log(`  ✓ criado: ${ADMIN.email}`);
  } else {
    console.log(`  • já existe: ${ADMIN.email}`);
  }
  const ownerId = admin.id;

  // ---- Workspace -----------------------------------------------------
  // A migration da F0.4 semeia o Workspace A PARTIR de um admin que já
  // existia — é o caminho de quem MIGROU do v1. Num banco NOVO não há
  // usuário quando ela roda, e o sistema subiria sem workspace nenhum
  // ("Nenhum workspace configurado"): o razão, o Outbox e as bandeiras de
  // funcionalidade dependem dele. O id repete a fórmula da migration para
  // que os dois caminhos cheguem exatamente ao mesmo registro.
  console.log("→ Workspace, entidade e agência");
  const { createHash } = await import("crypto");
  const idDe = (prefixo: string, semente: string) =>
    prefixo + createHash("md5").update(semente).digest("hex").slice(0, 21);

  let workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        id: idDe("ws_", ownerId),
        name: "B2C Gestão",
        timezone: "America/Bahia",
        locale: "pt-BR",
        currency: "BRL",
        ownerId,
      },
    });
    console.log("  ✓ workspace criado");
  } else {
    console.log(`  • workspace já existe: ${workspace.name}`);
  }

  // A entidade e a agência padrão vêm juntas: a agência é o recorte que a
  // carteira, o rateio e o RBAC usam, e um sistema sem nenhuma não deixa
  // sequer cadastrar cliente.
  let entidade = await prisma.legalEntity.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
  });
  if (!entidade) {
    entidade = await prisma.legalEntity.create({
      data: {
        id: idDe("le_", workspace.id),
        workspaceId: workspace.id,
        legalName: "B2C Gestão",
        tradeName: "B2C Gestão",
        timezone: workspace.timezone,
        currency: workspace.currency,
        active: true,
      },
    });
    console.log("  ✓ entidade criada");
  } else {
    console.log(`  • entidade já existe: ${entidade.tradeName ?? entidade.legalName}`);
  }

  // Bandeira do razão: nasce DESLIGADA, como na migration. Sem a linha, o
  // updateMany que a liga não encontra nada e falha em silêncio.
  const bandeira = await prisma.featureFlag.findFirst({
    where: { workspaceId: workspace.id, key: "ledger_enabled" },
  });
  if (!bandeira) {
    await prisma.featureFlag.create({
      data: {
        id: idDe("ff_", workspace.id + "ledger"),
        workspaceId: workspace.id,
        key: "ledger_enabled",
        enabled: false,
        description:
          "Libera a gravação de lançamentos no razão pelo AccountingEngine (01 §3.10).",
      },
    });
    console.log("  ✓ bandeira do razão criada (desligada)");
  }

  const agencia = await prisma.agency.findFirst({ where: { workspaceId: workspace.id } });
  if (!agencia) {
    await prisma.agency.create({
      data: {
        id: idDe("ag_", entidade.id),
        workspaceId: workspace.id,
        legalEntityId: entidade.id,
        name: "B2C Gestão",
        slug: "b2c-gestao",
        color: "#1E70D3",
        active: true,
      },
    });
    console.log("  ✓ agência criada");
  } else {
    console.log(`  • agência já existe: ${agencia.name}`);
  }

  // ---- Configuração: categorias (globais) e regras (do admin) --------
  // Create-only, como o seed principal: nunca sobrescreve o que existe.
  console.log("→ Categorias (globais)");
  let novasCategorias = 0;
  for (const c of CATEGORIES) {
    const exists = await prisma.category.findUnique({ where: { name: c.name } });
    if (!exists) {
      await prisma.category.create({ data: c });
      novasCategorias++;
    }
  }
  console.log(`  ✓ ${novasCategorias} criada(s) de ${CATEGORIES.length}`);

  console.log("→ Regras de categorização");
  let novasRegras = 0;
  for (const r of RULES) {
    const exists = await prisma.categorizationRule.findFirst({
      where: { name: r.name, ownerId },
    });
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
    novasRegras++;
  }
  console.log(`  ✓ ${novasRegras} criada(s) de ${RULES.length}`);

  // ---- Prova de que o sistema está sem dados -------------------------
  const contagens: [string, number][] = [
    ["Clientes", await prisma.client.count()],
    ["Contratos", await prisma.contract.count()],
    ["Cobranças", await prisma.billing.count()],
    ["Pagamentos", await prisma.payment.count()],
    ["Receitas", await prisma.income.count()],
    ["Receita Extra", await prisma.extraRevenue.count()],
    ["Despesas/transações", await prisma.transaction.count()],
    ["Colaboradores", await prisma.employee.count()],
    ["Folhas", await prisma.payroll.count()],
    ["Caixas/reservas", await prisma.cashBox.count()],
    ["Serviços", await prisma.service.count()],
    ["Ofertas", await prisma.offer.count()],
    ["Upsells", await prisma.upsell.count()],
    ["Pessoas", await prisma.person.count()],
    ["Cartões", await prisma.creditCard.count()],
    ["Contas bancárias", await prisma.account.count()],
  ];
  const sujas = contagens.filter(([, n]) => n > 0);

  console.log("\n📊 Dados de negócio no banco:");
  for (const [nome, n] of contagens) {
    console.log(`   ${n === 0 ? "✓" : "•"} ${nome.padEnd(22)} ${n}`);
  }
  console.log(
    `\n🔧 Configuração: ${await prisma.user.count()} usuário(s) · ` +
      `${await prisma.category.count()} categoria(s) · ` +
      `${await prisma.categorizationRule.count()} regra(s)`
  );
  console.log(
    sujas.length === 0
      ? "\n✓ Ambiente de desenvolvimento pronto — sistema completo, zero dados.\n"
      : `\n⚠️  ${sujas.length} tabela(s) de negócio com dados: ${sujas.map(([n]) => n).join(", ")}\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
