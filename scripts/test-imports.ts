/**
 * Teste (temporário) da importação em massa via XLSX.
 * Uso: npx tsx scripts/test-imports.ts
 */
import { loadEnv } from "./env";
loadEnv();
import * as XLSX from "xlsx";

const TAG = "__teste_imp__";

function sheet(headers: string[], rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Dados");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { readSheet, validateRows } = await import("@/lib/imports/engine");
  const { getImportDef, loadRefs } = await import("@/lib/imports/definitions");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  // pipeline idêntico ao da action (sem a parte de sessão/arquivo)
  async function run(tipo: string, buffer: Buffer, confirm = false) {
    const def = getImportDef(tipo)!;
    const raw = readSheet(buffer);
    const { rows, headerErrors } = validateRows(def.columns, raw);
    const [refs, existing] = await Promise.all([loadRefs(), def.existingKeys()]);
    const seen = new Set<string>();
    const prepared: Record<string, unknown>[] = [];
    let duplicadas = 0;
    for (const row of rows) {
      const err = (campo: string, erro: string) => row.errors.push({ linha: row.linha, campo, erro });
      const data = def.toData(row, refs, err);
      if (row.errors.length > 0 || !data) continue;
      const key = def.dupKey(data);
      if (existing.has(key) || seen.has(key)) { duplicadas++; continue; }
      seen.add(key);
      prepared.push(data);
    }
    let imported = 0;
    if (confirm && prepared.length) imported = await def.create(prepared, "");
    return {
      total: rows.length,
      validas: prepared.length,
      comErro: rows.filter((r) => r.errors.length > 0).length,
      duplicadas,
      erros: rows.flatMap((r) => r.errors),
      headerErrors,
      imported,
    };
  }

  await runWithOwner(admin!.id, async () => {
    // ===== 1. Clientes: 2 válidas + 1 sem nome + 1 status inválido + 1 duplicada na planilha
    const cliBuf = sheet(
      ["Nome", "Cidade", "UF", "Status", "Valor mensal (R$)", "Dia de pagamento"],
      [
        [`${TAG}Alfa`, "Salvador", "BA", "Ativo", "2500,00", 5],
        [`${TAG}Beta`, "São Paulo", "SP", "Prospect", 1800.5, 10],
        ["", "Recife", "PE", "Ativo", "100,00", 5],
        [`${TAG}Gama`, "Rio", "RJ", "Statusinvalido", "900,00", 5],
        [`${TAG}Alfa`, "Salvador", "BA", "Ativo", "2500,00", 5],
      ]
    );
    const r1 = await run("clientes", cliBuf, true);
    ok("1. clientes: total 5", r1.total === 5, `(${r1.total})`);
    ok("2. clientes: 2 válidas importadas", r1.validas === 2 && r1.imported === 2, `(${r1.validas}/${r1.imported})`);
    ok("3. clientes: 2 com erro (nome obrigatório + status inválido)", r1.comErro === 2, `(${JSON.stringify(r1.erros)})`);
    ok("4. clientes: 1 duplicada na planilha", r1.duplicadas === 1, `(${r1.duplicadas})`);

    // reimportar mesma planilha → duplicadas contra o banco
    const r1b = await run("clientes", cliBuf, false);
    ok("5. reimporte: 0 válidas, 3 duplicadas (banco+planilha)", r1b.validas === 0 && r1b.duplicadas === 3, `(${r1b.validas}/${r1b.duplicadas})`);

    // ===== 2. Contratos: caso canônico 5100/3 meses → mensal 1700 + cliente inexistente
    const conBuf = sheet(
      ["Cliente", "Título do contrato", "Tipo", "Valor total (R$)", "Início", "Fim"],
      [
        [`${TAG}Alfa`, `${TAG}Contrato 3m`, "Fechado", "5100,00", "01/06/2026", "31/08/2026"],
        ["Cliente Fantasma XYZ", `${TAG}Contrato x`, "Recorrente", "1000,00", "01/06/2026", ""],
      ]
    );
    const r2 = await run("contratos", conBuf, true);
    ok("6. contratos: 1 válida + 1 erro de cliente inexistente",
      r2.validas === 1 && r2.comErro === 1 && r2.erros[0].erro.includes("não encontrado"),
      `(${JSON.stringify(r2.erros[0] ?? {})})`);
    const contract = await prisma.contract.findFirst({ where: { title: `${TAG}Contrato 3m` } });
    ok("7. derivação: TCV 5100 / 3 meses → mensal 1700",
      Number(contract?.monthlyValue) === 1700 && Number(contract?.totalValue) === 5100,
      `(mensal ${contract?.monthlyValue})`);

    // ===== 3. Cobranças: vencida no passado → OVERDUE; competência inválida → erro
    const cobBuf = sheet(
      ["Cliente", "Descrição", "Competência", "Valor (R$)", "Vencimento", "Contrato"],
      [
        [`${TAG}Alfa`, `${TAG}cob junho`, "06/2026", "1700,00", "05/06/2026", `${TAG}Contrato 3m`],
        [`${TAG}Alfa`, `${TAG}cob futura`, "12/2026", "1700,00", "05/12/2026", ""],
        [`${TAG}Alfa`, `${TAG}cob errada`, "13/2026", "1700,00", "05/06/2026", ""],
      ]
    );
    const r3 = await run("cobrancas", cobBuf, true);
    const cob = await prisma.billing.findFirst({ where: { description: `${TAG}cob junho` } });
    const cobF = await prisma.billing.findFirst({ where: { description: `${TAG}cob futura` } });
    ok("8. cobranças: 2 válidas + 1 competência inválida", r3.validas === 2 && r3.comErro === 1, `(${r3.validas}/${r3.comErro})`);
    ok("9. cobrança passada → OVERDUE, futura → PENDING",
      cob?.status === "OVERDUE" && cobF?.status === "PENDING",
      `(${cob?.status}/${cobF?.status})`);
    ok("10. cobrança vinculada ao contrato pelo título", cob?.contractId === contract?.id);

    // ===== 4. Colaboradores + Folha (cria run DRAFT)
    await run("colaboradores", sheet(
      ["Nome", "Cargo", "Vínculo", "Salário fixo (R$)"],
      [[`${TAG}Maria`, "Designer", "PJ", "3000,00"]]
    ), true);
    const r4 = await run("folha", sheet(
      ["Competência", "Colaborador", "Tipo", "Valor (R$)"],
      [
        ["03/2099", `${TAG}Maria`, "Salário", "3000,00"],
        ["03/2099", "Fulano Inexistente", "Bônus", "500,00"],
      ]
    ), true);
    const run99 = await prisma.payroll.findFirst({ where: { month: 3, year: 2099 }, include: { items: true } });
    ok("11. folha: 1 item criado em run DRAFT novo + 1 erro de colaborador",
      r4.imported === 1 && r4.comErro === 1 && run99?.status === "DRAFT" && run99.items.length === 1,
      `(${r4.imported}/${r4.comErro}/${run99?.status})`);

    // ===== 5. Despesas: data/valor inválidos
    const r5 = await run("despesas", sheet(
      ["Data", "Descrição", "Valor (R$)", "Status", "Tipo"],
      [
        ["08/06/2026", `${TAG}ferramenta`, "250,00", "Paga", "Ferramenta"],
        ["99/99/9999", `${TAG}data ruim`, "100,00", "Paga", ""],
        ["01/06/2026", `${TAG}valor ruim`, "abc", "Paga", ""],
      ]
    ), true);
    ok("12. despesas: 1 válida + 2 erros (data e valor)", r5.validas === 1 && r5.comErro === 2, `(${r5.validas}/${r5.comErro})`);
    const desp = await prisma.transaction.findFirst({ where: { description: `${TAG}ferramenta` } });
    ok("13. despesa criada como empresa/ADS-tipo correto",
      desp?.belongsTo === "empresa" && desp?.expenseType === "TOOL" && desp?.status === "pago");

    // ===== 6. Ativos & Passivos
    const r6 = await run("ativos", sheet(
      ["Nome", "Tipo", "Valor (R$)"],
      [[`${TAG}Mac`, "Equipamento", "18000,00"]]
    ), true);
    const r7 = await run("passivos", sheet(
      ["Nome", "Tipo", "Valor total (R$)", "Saldo devedor (R$)"],
      [[`${TAG}Parcelamento`, "Imposto", "12000,00", ""]]
    ), true);
    const passivo = await prisma.liability.findFirst({ where: { name: `${TAG}Parcelamento` } });
    ok("14. ativo + passivo importados (saldo = total quando vazio)",
      r6.imported === 1 && r7.imported === 1 && Number(passivo?.remainingValue) === 12000,
      `(${passivo?.remainingValue})`);

    // ===== 7. Receitas
    const r8 = await run("receitas", sheet(
      ["Data", "Descrição", "Valor (R$)", "Status", "Cliente"],
      [["10/06/2026", `${TAG}receita`, "1700,00", "Recebida", `${TAG}Alfa`]]
    ), true);
    const inc = await prisma.income.findFirst({ where: { description: `${TAG}receita` } });
    ok("15. receita importada com cliente e competência",
      r8.imported === 1 && inc?.competenceMonth === 6 && inc?.clientId != null,
      `(${inc?.competenceMonth})`);

    // ===== limpeza =====
    await prisma.billing.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.contract.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.income.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.transaction.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.payrollItem.deleteMany({ where: { employee: { name: { startsWith: TAG } } } });
    await prisma.payroll.deleteMany({ where: { year: 2099 } });
    await prisma.employee.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.asset.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.liability.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
    console.log("16. limpeza: OK");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
