import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import {
  asOwner, createOwner, destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { parsePlanilhaTotal } from "@/lib/imports/total/parser";
import { aplicarPlanilhaTotal } from "@/lib/imports/total/aplicar";
import { COLUNAS_CLIENTES, COLUNAS_MENSAL } from "@/lib/imports/total/modelo";

/**
 * F1.12 (v2) — motor da Importação Total: a planilha constrói o PASSADO.
 * Roda contra o banco de teste real: cobrança, pagamento, termo e avaliação
 * passam pelos mesmos serviços de domínio do dado vivo.
 */

let dono: TestOwner;
const SUFIXO = Math.random().toString(36).slice(2, 7);
const DOC = "11.222.333/0001-44";
const NOME = `Cliente Historia ${SUFIXO}`;

function livro(abas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [nome, aoa] of Object.entries(abas))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa as any[][]), nome);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function planilhaBase() {
  return livro({
    CLIENTES: [
      [...COLUNAS_CLIENTES],
      [NOME, DOC, "", "", "E-commerce", "Salvador", "BA", "", "", "",
       "10/01/2026", "MRR", "2000,00", "", "", "10", "", "", "", "Ativo", "", "", ""],
    ],
    MENSAL: [
      [...COLUNAS_MENSAL],
      // jan: pago em dia · fev: pago em ABRIL (recuperação) · mar: valor sobe → termo novo · abr: vencido
      ["2026-01", DOC, "2000,00", "Pago", "10/01/2026", "", "Estável", "Ativo", "Baixo", "não", "", ""],
      ["2026-02", DOC, "2000,00", "Pago em 04/2026", "", "", "Crítico", "Pausado", "Alto", "não", "", "sumiu"],
      ["2026-03", DOC, "2600,00", "Pago", "12/03/2026", "", "Estável", "Ativo", "Baixo", "sim", "", ""],
      ["2026-04", DOC, "2600,00", "Vencido", "", "", "", "", "", "", "", ""],
    ],
  });
}

beforeAll(async () => { dono = await createOwner(); });
afterAll(async () => { await destroyOwner(dono); });

describe("F1.12 — aplicação por competência", () => {
  it("constrói 4 meses de história: cobranças, pagamentos, recuperação, termos e avaliações", async () => {
    const plan = parsePlanilhaTotal(planilhaBase());
    expect(plan.erros).toEqual([]);

    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "historia.xlsx", byEmail: dono.email })
    );

    expect(r.clientesCriados).toBe(1);
    expect(r.cobrancasCriadas).toBe(4);
    expect(r.pagamentosCriados).toBe(3);
    expect(r.avaliacoesGravadas).toBe(3);
    expect(r.competencias).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);

    const cliente = await asOwner(dono, async () =>
      prisma.client.findFirstOrThrow({
        where: { name: NOME },
        include: {
          billings: { orderBy: [{ competenceYear: "asc" }, { competenceMonth: "asc" }] },
        },
      })
    );

    // Janeiro pago em dia; abril aberto e vencido.
    const [jan, fev, mar, abr] = cliente.billings;
    expect(jan.status).toBe("PAID");
    expect(mar.status).toBe("PAID");
    expect(Number(mar.amount)).toBe(2600);
    expect(abr.status).toBe("OVERDUE");

    // Fevereiro: recuperação — pago, mas o pagamento vive em ABRIL (caixa).
    expect(fev.status).toBe("PAID");
    const pagamentoFev = await runWithoutScope(async () =>
      prisma.payment.findFirstOrThrow({
        where: { applications: { some: { billingId: fev.id } } },
        select: { paidAt: true, notes: true },
      })
    );
    expect(pagamentoFev.paidAt.getMonth()).toBe(3); // abril
    expect(pagamentoFev.notes).toContain("dia exato não informado");

    // Termos por vigência: 2000 desde a entrada, 2600 a partir de março.
    const rel = await runWithoutScope(async () =>
      prisma.clientAgencyRelationship.findFirstOrThrow({
        where: { clientId: cliente.id },
        include: { terms: { orderBy: { validFrom: "asc" } } },
      })
    );
    expect(rel.terms).toHaveLength(2);
    expect(Number(rel.terms[0].monthlyValue)).toBe(2000);
    expect(rel.terms[0].validTo).not.toBeNull();
    expect(Number(rel.terms[1].monthlyValue)).toBe(2600);
    expect(rel.terms[1].validFrom.getMonth()).toBe(2); // março
    expect(rel.terms[1].validTo).toBeNull();

    // Avaliações por competência (fev crítico) — a máquina do tempo lê daqui.
    const fevAval = await runWithoutScope(async () =>
      prisma.avaliacaoMensal.findUniqueOrThrow({
        where: { relationshipId_competence: { relationshipId: rel.id, competence: "2026-02" } },
      })
    );
    expect(fevAval.estabilidade).toBe("Crítico");
    expect(fevAval.risco).toBe("Alto");

    // Proveniência: cada linha aponta aba e linha de origem.
    const registros = await runWithoutScope(async () =>
      prisma.importedRecord.findMany({ where: { batchId: r.batchId } })
    );
    expect(registros.some((x) => x.sourceSheet === "CLIENTES" && x.entity === "cliente")).toBe(true);
    expect(registros.filter((x) => x.entity === "pagamento")).toHaveLength(3);
  });

  it("reimportar a MESMA planilha atualiza em vez de duplicar", async () => {
    const plan = parsePlanilhaTotal(planilhaBase());
    const r2 = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "historia.xlsx", byEmail: dono.email })
    );
    expect(r2.clientesCriados).toBe(0);
    expect(r2.clientesAtualizados).toBe(1);
    expect(r2.cobrancasCriadas).toBe(0);
    expect(r2.pagamentosCriados).toBe(0);

    const cliente = await asOwner(dono, async () =>
      prisma.client.findFirstOrThrow({
        where: { name: NOME },
        include: { billings: true },
      })
    );
    expect(cliente.billings).toHaveLength(4);

    const rel = await runWithoutScope(async () =>
      prisma.clientAgencyRelationship.findFirstOrThrow({
        where: { clientId: cliente.id },
        include: { terms: true },
      })
    );
    expect(rel.terms).toHaveLength(2); // nenhum termo duplicado
  });

  it("cobrança JÁ PAGA com valor divergente vira revisão — dinheiro pago nunca é reescrito", async () => {
    const alterada = livro({
      MENSAL: [
        [...COLUNAS_MENSAL],
        ["2026-01", DOC, "9999,00", "Pago", "10/01/2026", "", "", "", "", "", "", ""],
      ],
    });
    const plan = parsePlanilhaTotal(alterada);
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "alterada.xlsx", byEmail: dono.email })
    );
    expect(r.paraRevisar).toBeGreaterThan(0);
    const registro = await runWithoutScope(async () =>
      prisma.importedRecord.findFirstOrThrow({
        where: { batchId: r.batchId, reviewStatus: "PENDENTE" },
      })
    );
    expect(registro.reviewReason).toContain("nunca é reescrito");
    const jan = await asOwner(dono, async () =>
      prisma.billing.findFirstOrThrow({
        where: { client: { name: NOME }, competenceMonth: 1, competenceYear: 2026 },
      })
    );
    expect(Number(jan.amount)).toBe(2000); // intocada
  });

  it("nome parecido sem documento NÃO cria — vai para revisão humana", async () => {
    const quaseIgual = NOME.replace("Historia", "Histaria"); // 1 letra de distância
    const plan = parsePlanilhaTotal(
      livro({
        CLIENTES: [
          [...COLUNAS_CLIENTES],
          [quaseIgual, "", "", "", "", "", "", "", "", "",
           "01/02/2026", "MRR", "1500,00", "", "", "5", "", "", "", "Ativo", "", "", ""],
        ],
      })
    );
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "dedupe.xlsx", byEmail: dono.email })
    );
    expect(r.clientesCriados).toBe(0);
    expect(r.paraRevisar).toBe(1);
    const existe = await asOwner(dono, async () =>
      prisma.client.findFirst({ where: { name: quaseIgual } })
    );
    expect(existe).toBeNull();
  });

  it("Churn sem data assume o mês seguinte à última linha MENSAL — e AVISA", async () => {
    const doc2 = "55.666.777/0001-88";
    const plan = parsePlanilhaTotal(
      livro({
        CLIENTES: [
          [...COLUNAS_CLIENTES],
          [`Cliente Que Saiu ${SUFIXO}`, doc2, "", "", "", "", "", "", "", "",
           "05/01/2026", "MRR", "1000,00", "", "", "5", "", "", "", "Churn", "", "cansou", ""],
        ],
        MENSAL: [
          [...COLUNAS_MENSAL],
          ["2026-01", doc2, "1000,00", "Pago", "05/01/2026", "", "", "", "", "", "", ""],
          ["2026-02", doc2, "1000,00", "Pago", "05/02/2026", "", "", "", "", "", "", ""],
        ],
      })
    );
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "churn.xlsx", byEmail: dono.email })
    );
    expect(r.avisos.some((a) => a.includes("2026-03") && a.includes("assumido"))).toBe(true);
    const c = await asOwner(dono, async () =>
      prisma.client.findFirstOrThrow({ where: { document: doc2 } })
    );
    expect(c.churnedAt?.getMonth()).toBe(2); // março
    expect(c.status).toBe("CHURNED");
  });

  it("Sem cobrança não cria Billing; Removido cria cancelada auditada", async () => {
    const doc3 = "99.888.777/0001-66";
    const plan = parsePlanilhaTotal(
      livro({
        CLIENTES: [
          [...COLUNAS_CLIENTES],
          [`Cliente Pausas ${SUFIXO}`, doc3, "", "", "", "", "", "", "", "",
           "01/01/2026", "MRR", "800,00", "", "", "5", "", "", "", "Ativo", "", "", ""],
        ],
        MENSAL: [
          [...COLUNAS_MENSAL],
          ["2026-01", doc3, "", "Sem cobrança", "", "", "", "", "", "", "", "acordo de carência"],
          ["2026-02", doc3, "800,00", "Removido", "", "", "", "", "", "", "", ""],
        ],
      })
    );
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "pausas.xlsx", byEmail: dono.email })
    );
    expect(r.paraRevisar).toBe(0);
    const cobrancas = await asOwner(dono, async () =>
      prisma.billing.findMany({ where: { client: { document: doc3 } } })
    );
    expect(cobrancas).toHaveLength(1);
    expect(cobrancas[0].competenceMonth).toBe(2);
    expect(cobrancas[0].status).toBe("CANCELED");
    expect(cobrancas[0].cancelReason).toContain("Removido na importação");
  });
});
