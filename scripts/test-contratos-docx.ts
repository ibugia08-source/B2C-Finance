/**
 * Teste (temporário) do módulo de contratos documentais:
 * extração de variáveis, storage, geração de DOCX e dossiê do cliente.
 * Uso: npx tsx scripts/test-contratos-docx.ts
 */
import { loadEnv } from "./env";
loadEnv();

import { readFileSync, existsSync } from "fs";

const TAG = "__teste_docx__";
const REAL_TEMPLATE = "/Users/macbook/Downloads/MRR - 1.200 - SEMESTRAL.docx";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { extractTemplateVariables, fillTemplate } = await import("@/lib/docx/template");
  const { putFile, getFile, removeFile, storageDriverName } = await import("@/lib/storage");

  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  if (!existsSync(REAL_TEMPLATE)) {
    console.error("Modelo real não encontrado:", REAL_TEMPLATE);
    process.exit(1);
  }
  const buf = readFileSync(REAL_TEMPLATE);

  // ===== 1. Extração =====
  const { variables, warnings } = extractTemplateVariables(buf);
  ok("1. extração: 6 variáveis no modelo MRR real", variables.length === 6, `(${variables.length})`);
  const v15 = variables.find((v) => v.rawName === "15");
  ok(
    "2. {{15}} vira 'Dia de vencimento' + clientField contract.dueDay",
    v15?.label === "Dia de vencimento" && v15?.clientField === "contract.dueDay"
  );
  ok("3. alerta de variável pouco descritiva gerado", warnings.some((w) => w.includes("{{15}}")));
  const nome = variables.find((v) => v.key === "nome_da_empresa");
  ok(
    "4. normalização + mapeamento (Nome da empresa → client.name)",
    nome?.key === "nome_da_empresa" && nome?.clientField === "client.name"
  );

  // ===== 2. Storage =====
  const path = `contract-templates/${TAG}/modelo.docx`;
  await putFile(path, buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const roundtrip = await getFile(path);
  ok(`5. storage (${storageDriverName()}): grava e lê o mesmo conteúdo`, roundtrip.equals(buf));

  // ===== 3. Geração preservando o original =====
  const values: Record<string, string> = {};
  for (const v of variables) {
    values[v.rawName] =
      v.rawName === "15" ? "10" :
      v.key === "nome_da_empresa" ? `${TAG} Ótica Vision` :
      v.key === "data_de_inicio" ? "10/07/2026" : "Valor X";
  }
  const filled = fillTemplate(roundtrip, values);
  const after = extractTemplateVariables(filled);
  ok("6. DOCX gerado sem variáveis restantes", after.variables.length === 0, `(${after.variables.length})`);
  ok("7. modelo original intacto no storage", (await getFile(path)).equals(buf));

  // ===== 4. Registros no banco (modelo → gerado → dossiê) =====
  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );

  await runWithOwner(admin!.id, async () => {
    const client = await prisma.client.create({
      data: { name: `${TAG}Cliente`, status: "ACTIVE", document: "12.345.678/0001-90" },
    });
    const template = await prisma.contractTemplate.create({
      data: {
        name: `${TAG}Modelo MRR`,
        commercialType: "MRR",
        monthlyAmount: 1200,
        durationType: "SEMIANNUAL",
        durationMonths: 6,
        defaultDueDay: 15,
        originalFileName: "MRR - 1.200 - SEMESTRAL.docx",
        filePath: path,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileSize: buf.length,
        variables: variables as any,
        warnings: warnings as any,
      },
    });

    const genPath = `generated-contracts/${TAG}/contrato.docx`;
    await putFile(genPath, filled, template.mimeType);
    const generated = await prisma.generatedContract.create({
      data: {
        templateId: template.id,
        clientId: client.id,
        name: `${TAG}Contrato Ótica Vision`,
        commercialType: "MRR",
        amount: 1200,
        dueDay: 10,
        filledVariables: values as any,
        generatedFileName: "contrato.docx",
        generatedFilePath: genPath,
      },
    });
    ok("8. contrato gerado associado ao cliente e ao modelo",
      generated.clientId === client.id && generated.templateId === template.id);

    await prisma.clientDocument.create({
      data: {
        clientId: client.id,
        name: `${TAG}Contrato assinado`,
        documentType: "CONTRACT",
        fileName: "contrato.docx",
        filePath: genPath,
        mimeType: template.mimeType,
        size: filled.length,
      },
    });
    await prisma.clientNote.create({
      data: {
        clientId: client.id,
        title: `${TAG}Particularidades`,
        content: "Cliente prefere cobrança via pix no dia 10.",
        type: "negociacao",
      },
    });
    const [docs, notes] = await Promise.all([
      prisma.clientDocument.count({ where: { clientId: client.id } }),
      prisma.clientNote.count({ where: { clientId: client.id } }),
    ]);
    ok("9. documento + contexto anexados ao cliente", docs === 1 && notes === 1, `(${docs}/${notes})`);

    // ===== 5. Isolamento: outro dono não enxerga =====
    const other = await runWithoutScope(async () =>
      prisma.user.findFirst({
        where: { role: "ADMIN", id: { not: admin!.id } },
        select: { id: true },
      })
    );
    if (other) {
      const leaked = await runWithOwner(other.id, async () =>
        Promise.all([
          prisma.contractTemplate.count({ where: { name: { startsWith: TAG } } }),
          prisma.generatedContract.count({ where: { name: { startsWith: TAG } } }),
          prisma.clientDocument.count({ where: { name: { startsWith: TAG } } }),
          prisma.clientNote.count({ where: { title: { startsWith: TAG } } }),
        ])
      );
      ok("10. isolamento por dono (0 vazamentos)", leaked.every((n) => n === 0), `(${leaked.join(",")})`);
    } else {
      // fallback: escopo fail-closed sem dono
      console.log("10. isolamento: só há 1 admin — pulado (coberto por test-erp-isolation)");
    }

    // limpeza
    await prisma.clientNote.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.clientDocument.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.generatedContract.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.contractTemplate.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
  });
  await removeFile(path);
  await removeFile(`generated-contracts/${TAG}/contrato.docx`);
  console.log("11. limpeza: OK");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
