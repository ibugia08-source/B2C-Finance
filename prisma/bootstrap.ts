import bcrypt from "bcryptjs";
import { loadEnv } from "../scripts/env";
import { semear as semearContas } from "./seed-chart-of-accounts";
import { semear as semearMetricas } from "./seed-metric-registry";
import { semear as semearRegras } from "./seed-posting-rules";

loadEnv();

/**
 * BOOTSTRAP — faz um banco VAZIO virar um sistema que funciona.
 *
 * Por que isto existe: as migrations semeiam workspace, entidade e agência a
 * partir de um administrador QUE JÁ EXISTA — é o caminho de quem migrou do
 * sistema antigo. Num banco novo não há usuário quando elas rodam, então
 * nada disso nasce, e o sistema sobe sem workspace: toda tela estoura em
 * "Nenhum workspace configurado". Este script fecha essa lacuna e roda no
 * deploy, então a instalação limpa funciona por construção.
 *
 * TUDO AQUI É CREATE-ONLY. Nenhuma linha é apagada ou sobrescrita: se a
 * configuração já existe, o script diz que existe e segue. É por isso que
 * ele pode rodar em produção a cada publicação sem oferecer risco a dado
 * nenhum — e por isso NÃO passa pela guarda de scripts destrutivos, que
 * existe para operações que apagam.
 *
 * Os ids repetem a fórmula das migrations de propósito: quem migrou do
 * sistema antigo e quem instalou do zero chegam ao MESMO registro.
 */

const ADMIN = {
  name: process.env.ADMIN_NAME ?? "Admin B2C Finance",
  email: process.env.ADMIN_EMAIL ?? "admin@b2cfinance.local",
  // Sem padrão: senha publicada em repositório vira credencial conhecida.
  senha: process.env.ADMIN_PASSWORD,
};

export async function bootstrap() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { createHash } = await import("crypto");
  const idDe = (prefixo: string, semente: string) =>
    prefixo + createHash("md5").update(semente).digest("hex").slice(0, 21);

  await runWithoutScope(async () => {
    // ---- Dono da conta ----
    let admin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      orderBy: { createdAt: "asc" },
    });
    if (!admin) {
      if (!ADMIN.senha) {
        throw new Error(
          [
            "Banco sem nenhum administrador e ADMIN_PASSWORD não definido.",
            "",
            "O sistema precisa de um dono para existir: é dele que nascem o",
            "workspace e a agência. Defina ADMIN_EMAIL e ADMIN_PASSWORD nas",
            "variáveis de ambiente e publique de novo.",
          ].join("\n")
        );
      }
      admin = await prisma.user.create({
        data: {
          name: ADMIN.name,
          email: ADMIN.email,
          passwordHash: await bcrypt.hash(ADMIN.senha, 10),
          role: "ADMIN",
          active: true,
        },
      });
      console.log(`→ administrador criado: ${admin.email}`);
    } else {
      console.log(`· administrador já existe: ${admin.email}`);
    }

    // ---- Workspace ----
    let workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          id: idDe("ws_", admin.id),
          name: "B2C Gestão",
          timezone: "America/Bahia",
          locale: "pt-BR",
          currency: "BRL",
          ownerId: admin.id,
        },
      });
      console.log("→ workspace criado");
    } else {
      console.log(`· workspace já existe: ${workspace.name}`);
    }

    // ---- Entidade e agência ----
    // A agência é o recorte que a carteira, o rateio e as permissões usam;
    // sem nenhuma, não se cadastra sequer um cliente.
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
      console.log("→ entidade criada");
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
      console.log("→ agência criada");
    }

    // ---- Bandeira do razão (nasce desligada, como na migration) ----
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
      console.log("→ bandeira do razão criada (desligada)");
    }
  });

  // ---- Configuração canônica (create-only, idempotente) ----
  await semearContas();
  await semearMetricas();
  await semearRegras();
}

async function main() {
  const alvo = (process.env.POSTGRES_PRISMA_URL ?? "").replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
  console.log(`→ bootstrap · banco: ${alvo || "(não configurado)"}`);
  await bootstrap();
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
  console.log("✓ sistema pronto para uso");
}

if ((process.argv[1] ?? "").endsWith("bootstrap.ts")) {
  main().catch((e) => {
    console.error("\n✖ bootstrap falhou\n");
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
