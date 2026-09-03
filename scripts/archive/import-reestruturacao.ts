/**
 * IMPORTA OS DADOS REAIS DE 2026 (pasta ../Reestruturacao) no banco de
 * DESENVOLVIMENTO — clientes, acordos, cobranças, recebimentos, despesas,
 * folha, serviços e colaboradores extraídos da planilha gerencial do dono.
 *
 * Regras de fidelidade:
 *  - Totais mensais (esperado/recebido/despesas) são REAIS — batem com a
 *    planilha do dono. O rateio POR CLIENTE dos recebimentos foi feito
 *    proporcionalmente na origem; cada registro carrega essa nota para o
 *    saldo individual não virar cobrança cega.
 *  - Recorrente → cliente MRR (mensalidade automática daqui em diante).
 *    Fechado → cliente TCV (valor total no contrato; renovação gerencia).
 *  - Pagamento maior que o saldo da cobrança do mês → o excesso quita as
 *    cobranças ANTIGAS do mesmo cliente (regra oficial de recuperação).
 *
 * Segurança: só roda em banco local (127.0.0.1/localhost) e só se a base
 * de negócio estiver vazia.
 *
 * Uso: npx tsx scripts/import-reestruturacao.ts
 */
import { loadEnv } from "../env";
import { assertDestructiveAllowed } from "../guard";
loadEnv();
import { readFileSync } from "fs";
import { resolve } from "path";
import * as XLSX from "xlsx";

const DIR = resolve(process.cwd(), "../Reestruturacao");

// ---------- helpers de parsing ----------
const money = (v: unknown): number => {
  const s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!s) return 0;
  return Math.round(parseFloat(s.replace(/,/g, "")) * 100) / 100;
};
const dateOf = (v: unknown): Date | null => {
  if (v instanceof Date && !isNaN(v.getTime()))
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let d = +m[1];
    const mo = +m[2], y = +m[3];
    const last = new Date(y, mo, 0).getDate();
    if (d > last) d = last; // 29/02/2026 → 28/02/2026
    return new Date(y, mo - 1, d);
  }
  return null;
};
const comp = (s: string): { month: number; year: number } => {
  const m = String(s).match(/^(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`competência inválida: ${s}`);
  return { month: +m[1], year: +m[2] };
};

function sheet(file: string): Record<string, unknown>[] {
  const wb = XLSX.read(readFileSync(`${DIR}/${file}`), { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

const NOTA_RATEIO =
  "Histórico 2026 importado da planilha gerencial. Valor individual rateado do total mensal — não usar como saldo cobrável isolado.";

async function main() {
  // Guarda única do repositório (03 §4.6): ambiente explícito + ALLOW_DESTRUCTIVE
  // + conferência de que o APP_ENV declarado bate com o banco configurado.
  assertDestructiveAllowed({
    script: "scripts/import-reestruturacao.ts",
    allowEnvs: ["local", "staging"],
  });

  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { settleBillingPayment } = await import("@/lib/services/payment-accounting");

  await runWithoutScope(async () => {
    const nClients = await prisma.client.count();
    if (nClients > 0) {
      console.error(`⛔ ABORTADO: o banco já tem ${nClients} cliente(s). Importe apenas em base vazia.`);
      process.exit(1);
    }
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    if (!admin) throw new Error("Admin não encontrado — rode npm run db:seed:dev antes.");
    const ownerId = admin.id;

    // ===== 1. Colaboradores =====
    console.log("→ Colaboradores");
    const colabs = sheet("b2c-importacao-colaboradores.xlsx");
    const empByName = new Map<string, string>();
    for (const r of colabs) {
      const e = await prisma.employee.create({
        data: {
          name: String(r["Nome"]).trim(),
          role: String(r["Cargo"] ?? "") || null,
          type: (String(r["Vínculo (PJ/CLT/Freelancer)"] ?? "PJ").toUpperCase() as any) || "PJ",
          baseSalary: money(r["Salário fixo (R$)"]),
          startedAt: dateOf(r["Início"]),
          notes: String(r["Observações"] ?? "") || null,
          ownerId,
        },
      });
      empByName.set(e.name.toUpperCase(), e.id);
    }
    console.log(`  ✓ ${empByName.size}`);

    // ===== 2. Serviços =====
    console.log("→ Serviços");
    const servs = sheet("b2c-importacao-servicos.xlsx");
    for (const r of servs) {
      await prisma.service.create({
        data: {
          name: String(r["Nome"]).trim(),
          category: String(r["Categoria"] ?? "") || null,
          defaultPrice: money(r["Preço base (R$)"]) || null,
          estimatedCost: money(r["Custo estimado (R$)"]) || null,
          defaultOwner: String(r["Responsável padrão"] ?? "") || null,
          description: String(r["Descrição"] ?? "") || null,
          ownerId,
        },
      });
    }
    console.log(`  ✓ ${servs.length}`);

    // ===== 3. Acordos (lidos antes: datas e modalidade alimentam o cliente) =====
    const acordos = sheet("b2c-importacao-acordos.xlsx");
    const acordoByClient = new Map<string, Record<string, unknown>>();
    for (const r of acordos) acordoByClient.set(String(r["Cliente"]).trim(), r);

    // ===== 4. Clientes =====
    console.log("→ Clientes");
    const clientes = sheet("b2c-importacao-clientes.xlsx");
    const cliByName = new Map<string, string>();
    let nAtivo = 0, nPerdido = 0;
    for (const r of clientes) {
      const name = String(r["Nome"]).trim();
      const ac = acordoByClient.get(name);
      const tipo = ac ? String(ac["Tipo (Recorrente/Fechado/Avulso/Setup)"]) : "Recorrente";
      const isTcv = tipo === "Fechado";
      const perdido = String(r["Status"]).trim() === "Perdido";
      const inicio = ac ? dateOf(ac["Início"]) : null;
      const fim = ac ? dateOf(ac["Fim"]) : null;
      const mensal = money(r["Valor mensal (R$)"]);
      const c = await prisma.client.create({
        data: {
          name,
          legalName: String(r["Razão social"] ?? "") || null,
          email: String(r["E-mail"] ?? "") || null,
          phone: String(r["Telefone"] ?? "") || null,
          segment: String(r["Segmento"] ?? "") || null,
          city: "Salvador",
          state: "BA",
          origin: String(r["Origem"] ?? "") || null,
          salesOwner: String(r["Responsável comercial"] ?? "") || null,
          salesOwnerId: empByName.get(String(r["Responsável comercial"]).toUpperCase()) ?? null,
          paymentDay: parseInt(String(r["Dia de pagamento"]), 10) || null,
          status: perdido ? "CHURNED" : "ACTIVE",
          modality: isTcv ? "TCV" : "MRR",
          monthlyValue: isTcv ? null : mensal || null,
          totalContractValue: isTcv && ac ? money(ac["Valor total"]) || null : null,
          startedAt: inicio,
          churnedAt: perdido ? fim : null,
          notes: String(r["Observações"] ?? "") || null,
          ownerId,
        },
      });
      cliByName.set(name, c.id);
      perdido ? nPerdido++ : nAtivo++;

      // Perda registrada (alimenta churn/retenção)
      if (perdido) {
        await prisma.clientLoss.create({
          data: {
            clientId: c.id,
            lostAt: fim ?? new Date(2026, 7, 1),
            modality: isTcv ? "TCV" : "MRR",
            monthlyValue: mensal || null,
            referenceValue: isTcv && ac ? money(ac["Valor total"]) || null : null,
            salesOwner: String(r["Responsável comercial"] ?? "") || null,
            reason: "Importado do histórico 2026 (motivo não registrado na origem).",
            ownerId,
          },
        });
      }
    }
    console.log(`  ✓ ${cliByName.size} (${nAtivo} ativos, ${nPerdido} perdidos)`);

    // ===== 5. Contratos =====
    console.log("→ Contratos");
    const contractByClient = new Map<string, string>();
    for (const r of acordos) {
      const name = String(r["Cliente"]).trim();
      const clientId = cliByName.get(name);
      if (!clientId) { console.warn(`  ⚠️ acordo sem cliente: ${name}`); continue; }
      const isTcv = String(r["Tipo (Recorrente/Fechado/Avulso/Setup)"]) === "Fechado";
      const perdido = String(r["Status"]).trim() === "Perdido";
      const fim = dateOf(r["Fim"]);
      const ct = await prisma.contract.create({
        data: {
          clientId,
          title: String(r["Título do contrato"]).trim(),
          type: isTcv ? "TCV" : "MRR",
          status: perdido ? "CANCELED" : "ACTIVE",
          recurrence: isTcv ? "NONE" : "MONTHLY",
          monthlyValue: isTcv ? 0 : money(r["Valor mensal"]),
          totalValue: isTcv ? money(r["Valor total"]) : 0,
          startDate: dateOf(r["Início"]) ?? new Date(2026, 0, 1),
          endDate: fim,
          canceledAt: perdido ? fim : null,
          billingDay: Math.min(28, parseInt(String(r["Dia de cobrança"]), 10) || 5),
          autoRenew: String(r["Renovação"]).trim() === "Automática",
          notes: String(r["Observações"] ?? "") || null,
          ownerId,
        },
      });
      contractByClient.set(name, ct.id);
    }
    console.log(`  ✓ ${contractByClient.size}`);

    // ===== 6. Cobranças =====
    console.log("→ Cobranças");
    const cobr = sheet("b2c-importacao-cobrancas.xlsx");
    // chave cliente|mm/aaaa → billingId (para casar os recebimentos)
    const billingKey = new Map<string, string>();
    const billingOrder = new Map<string, string[]>(); // cliente → billings em ordem cronológica
    for (const r of cobr) {
      const name = String(r["Cliente"]).trim();
      const clientId = cliByName.get(name);
      if (!clientId) { console.warn(`  ⚠️ cobrança sem cliente: ${name}`); continue; }
      const { month, year } = comp(String(r["Competência (mm/aaaa)"]));
      const due = dateOf(r["Vencimento"]) ?? new Date(year, month - 1, 5);
      const b = await prisma.billing.create({
        data: {
          clientId,
          contractId: contractByClient.get(name) ?? null,
          description: String(r["Descrição"]).trim(),
          competenceMonth: month,
          competenceYear: year,
          amount: money(r["Valor (R$)"]),
          dueDate: due,
          revenueType: String(r["Tipo de receita"]).trim() === "TCV" ? "TCV" : "MRR",
          status: "PENDING",
          notes: `${NOTA_RATEIO} ${String(r["Observações"] ?? "")}`.trim(),
          ownerId,
        },
        select: { id: true },
      });
      billingKey.set(`${name}|${String(r["Competência (mm/aaaa)"])}`, b.id);
      const arr = billingOrder.get(name) ?? [];
      arr.push(b.id);
      billingOrder.set(name, arr);
    }
    console.log(`  ✓ ${billingKey.size}`);

    // ===== 7. Recebimentos (pagamentos conciliados pelo núcleo contábil) =====
    console.log("→ Recebimentos (conciliação)");
    const receitas = sheet("b2c-importacao-receitas.xlsx");
    let pagos = 0, excedentes = 0, falhas = 0;
    for (const r of receitas) {
      const name = String(r["Cliente"]).trim();
      const dt = dateOf(r["Data"]);
      if (!dt) { falhas++; continue; }
      const key = `${name}|${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
      let restante = money(r["Valor (R$)"]);
      const alvo = billingKey.get(key);

      // 1º: quita a cobrança do próprio mês
      if (alvo && restante > 0.009) {
        const b = await prisma.billing.findUnique({
          where: { id: alvo },
          select: { amount: true, paidTotal: true },
        });
        const aberto = Number(b!.amount) - Number(b!.paidTotal);
        const parcela = Math.min(restante, aberto);
        if (parcela > 0.009) {
          const res = await settleBillingPayment({
            billingId: alvo, amount: Math.round(parcela * 100) / 100,
            paidAt: dt, method: "PIX", accountId: null, notes: NOTA_RATEIO,
          });
          if (res.ok) { pagos++; restante -= parcela; } else { falhas++; console.warn(`  ⚠️ ${name}: ${res.error}`); }
        }
      }
      // 2º: excedente vai para as cobranças ANTIGAS em aberto do mesmo cliente
      if (restante > 0.009) {
        for (const bid of billingOrder.get(name) ?? []) {
          if (restante <= 0.009) break;
          const b = await prisma.billing.findUnique({
            where: { id: bid }, select: { amount: true, paidTotal: true, status: true },
          });
          if (!b || b.status === "PAID") continue;
          const aberto = Number(b.amount) - Number(b.paidTotal);
          if (aberto <= 0.009) continue;
          const parcela = Math.min(restante, aberto);
          const res = await settleBillingPayment({
            billingId: bid, amount: Math.round(parcela * 100) / 100,
            paidAt: dt, method: "PIX", accountId: null,
            notes: `${NOTA_RATEIO} Excedente aplicado a competência anterior (recuperação).`,
          });
          if (res.ok) { excedentes++; restante -= parcela; } else break;
        }
      }
    }
    console.log(`  ✓ ${pagos} pagamentos + ${excedentes} recuperações · falhas: ${falhas}`);

    // marca vencidas o que ficou em aberto no passado
    const hoje = new Date();
    const venc = await prisma.billing.updateMany({
      where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: hoje } },
      data: { status: "OVERDUE" },
    });
    console.log(`  ✓ ${venc.count} cobranças passadas marcadas como vencidas`);

    // ===== 8. Categorias de despesa =====
    console.log("→ Despesas");
    const catNames = ["Tráfego Pago", "Folha de Pagamento", "Impostos", "Ferramentas", "Aluguel / Escritório"];
    const catByName = new Map<string, string>();
    for (const nome of catNames) {
      const found = await prisma.category.findUnique({ where: { name: nome } });
      const cat = found ?? (await prisma.category.create({ data: { name: nome, kind: "despesa" } }));
      catByName.set(nome, cat.id);
    }
    const TIPO_MAP: Record<string, string> = {
      "Mídia-Ads": "ADS", Imposto: "TAX", Ferramenta: "TOOL", Fixa: "FIXED",
    };
    const desp = sheet("b2c-importacao-despesas.xlsx");
    for (const r of desp) {
      const categoria = String(r["Categoria"]).trim();
      const tipoRaw = String(r["Tipo (Fixa/Variável/Imposto/Ferramenta/Mídia-Ads/Outra)"]).trim();
      const expenseType = categoria === "Folha de Pagamento" ? "PAYROLL" : TIPO_MAP[tipoRaw] ?? "OTHER";
      const dt = dateOf(r["Data"]) ?? new Date(2026, 0, 15);
      await prisma.transaction.create({
        data: {
          date: dt,
          description: String(r["Descrição"]).trim(),
          amount: money(r["Valor (R$)"]),
          type: "despesa",
          origin: "pix",
          belongsTo: "empresa",
          status: "pago",
          dueDate: dt,
          expenseType: expenseType as any,
          categoryId: catByName.get(categoria) ?? null,
          notes: "Histórico 2026 importado da planilha gerencial.",
          ownerId,
        },
      });
    }
    console.log(`  ✓ ${desp.length}`);

    // ===== 9. Folha =====
    console.log("→ Folha");
    const folha = sheet("b2c-importacao-folha.xlsx");
    const runByComp = new Map<string, string>();
    let itens = 0;
    for (const r of folha) {
      const { month, year } = comp(String(r["Competência (mm/aaaa)"]));
      const k = `${year}-${month}`;
      let payrollId = runByComp.get(k);
      if (!payrollId) {
        const p = await prisma.payroll.create({
          data: { month, year, status: "PAID", paidAt: new Date(year, month - 1, 15), ownerId },
          select: { id: true },
        });
        payrollId = p.id;
        runByComp.set(k, payrollId);
      }
      const empId = empByName.get(String(r["Colaborador"]).toUpperCase());
      if (!empId) { console.warn(`  ⚠️ colaborador não achado: ${r["Colaborador"]}`); continue; }
      const kindRaw = String(r["Tipo (Salário/Bônus/Comissão/Benefício/Reembolso/Desconto)"]).trim();
      const KIND: Record<string, string> = {
        "Salário": "SALARY", "Bônus": "BONUS", "Comissão": "COMMISSION",
        "Benefício": "BENEFIT", Reembolso: "REIMBURSEMENT", Desconto: "DEDUCTION",
      };
      await prisma.payrollItem.create({
        data: {
          payrollId, employeeId: empId,
          kind: (KIND[kindRaw] ?? "SALARY") as any,
          amount: money(r["Valor (R$)"]),
          notes: String(r["Observação"] ?? "") || null,
          ownerId,
        },
      });
      itens++;
    }
    console.log(`  ✓ ${runByComp.size} folhas · ${itens} itens`);

    // ===== 10. Conferência final =====
    console.log("\n📊 CONFERÊNCIA (banco × planilha do dono):");
    const bills = await prisma.billing.findMany({
      select: { competenceMonth: true, amount: true, paidTotal: true },
    });
    const esp: Record<number, number> = {}, rec: Record<number, number> = {};
    for (const b of bills) {
      esp[b.competenceMonth] = (esp[b.competenceMonth] ?? 0) + Number(b.amount);
    }
    const pays = await prisma.payment.findMany({ select: { amount: true, paidAt: true } });
    for (const p of pays) {
      const m = p.paidAt.getMonth() + 1;
      rec[m] = (rec[m] ?? 0) + Number(p.amount);
    }
    const ALVO_ESP = [52072, 57440, 79050, 67880, 59980, 78890, 31900, 38606];
    const ALVO_REC = [44582, 50150, 73260, 50001, 34490, 44600, 44600, 13747];
    const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago"];
    let okAll = true;
    for (let m = 1; m <= 8; m++) {
      const e = Math.round(esp[m] ?? 0), rv = Math.round(rec[m] ?? 0);
      const okE = Math.abs(e - ALVO_ESP[m - 1]) <= 2, okR = Math.abs(rv - ALVO_REC[m - 1]) <= 2;
      if (!okE || !okR) okAll = false;
      console.log(
        `  ${MES[m - 1]}: esperado ${e.toLocaleString("pt-BR")} ${okE ? "✓" : `✗ (alvo ${ALVO_ESP[m - 1]})`}` +
        ` · recebido ${rv.toLocaleString("pt-BR")} ${okR ? "✓" : `✗ (alvo ${ALVO_REC[m - 1]})`}`
      );
    }
    const nums = {
      clientes: await prisma.client.count(),
      ativos: await prisma.client.count({ where: { status: "ACTIVE" } }),
      perdas: await prisma.clientLoss.count(),
      contratos: await prisma.contract.count(),
      cobrancas: await prisma.billing.count(),
      pagamentos: await prisma.payment.count(),
      receitas: await prisma.income.count(),
      despesas: await prisma.transaction.count(),
      folhas: await prisma.payroll.count(),
      servicos: await prisma.service.count(),
      colaboradores: await prisma.employee.count(),
    };
    console.log("\n  Totais:", JSON.stringify(nums));
    console.log(okAll ? "\n✅ IMPORT CONCLUÍDO — números batem com a planilha do dono." : "\n⚠️ IMPORT CONCLUÍDO COM DIVERGÊNCIAS — confira acima.");
  });

  const { prisma: db } = await import("@/lib/prisma");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
