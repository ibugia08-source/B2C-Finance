import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import {
  asOwner, createOwner, destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { parsePlanilhaTotal } from "@/lib/imports/total/parser";
import { aplicarPlanilhaTotal } from "@/lib/imports/total/aplicar";
import { reverterLoteTotal } from "@/lib/imports/total/reverter";
import { reconciliarPorMes } from "@/lib/imports/total/reconciliar";
import { COLUNAS_CLIENTES, COLUNAS_MENSAL } from "@/lib/imports/total/modelo";

/**
 * F1.13 (v2) — reconciliação por mês (pura) e reversão total do lote.
 */

let dono: TestOwner;
const SUFIXO = Math.random().toString(36).slice(2, 7);
const DOC = "77.111.222/0001-33";
const NOME = `Cliente Reversivel ${SUFIXO}`;

function livro(abas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [nome, aoa] of Object.entries(abas))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa as any[][]), nome);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const PLANILHA = () =>
  livro({
    CLIENTES: [
      [...COLUNAS_CLIENTES],
      [NOME, DOC, "", "", "", "", "", "", "", "",
       "05/01/2026", "MRR", "1200,00", "", "", "8", "", "", "", "Ativo", "", "", ""],
    ],
    MENSAL: [
      [...COLUNAS_MENSAL],
      ["2026-01", DOC, "1200,00", "Pago", "08/01/2026", "", "Estável", "Ativo", "Baixo", "não", "", ""],
      ["2026-02", DOC, "1500,00", "Vencido", "", "", "Crítico", "Pausado", "Alto", "não", "", ""],
      ["2026-03", DOC, "1500,00", "Pago em 05/2026", "", "", "", "", "", "", "", ""],
    ],
  });

beforeAll(async () => { dono = await createOwner(); });
afterAll(async () => { await destroyOwner(dono); });

describe("reconciliação por mês (prévia pura)", () => {
  it("esperado/recebido/recuperado/vencido/críticos por competência", () => {
    const plan = parsePlanilhaTotal(PLANILHA());
    const rec = reconciliarPorMes(plan);
    expect(rec.map((r) => r.competencia)).toEqual(["2026-01", "2026-02", "2026-03"]);

    const [jan, fev, mar] = rec;
    expect(jan).toMatchObject({ ativos: 1, esperado: 1200, recebido: 1200, vencido: 0, criticos: 0 });
    expect(fev).toMatchObject({ ativos: 1, esperado: 1500, recebido: 0, vencido: 1500, criticos: 1 });
    // Pago em 05/2026: o mês original fica VENCIDO e o valor aparece como RECUPERADO.
    expect(mar).toMatchObject({ esperado: 1500, recebido: 0, recuperado: 1500, vencido: 1500 });
  });

  it("linha sem valor e sem cliente conhecido conta como 'sem valor', não some", () => {
    const plan = parsePlanilhaTotal(
      livro({
        MENSAL: [
          [...COLUNAS_MENSAL],
          ["2026-01", "Cliente Fantasma XYZ", "", "Vencido", "", "", "", "", "", "", "", ""],
        ],
      })
    );
    const rec = reconciliarPorMes(plan);
    expect(rec[0].semValor).toBe(1);
    expect(rec[0].esperado).toBe(0);
  });
});

describe("reversão total do lote", () => {
  it("desfaz tudo o que o lote criou — cliente, cobranças, pagamentos, termos, avaliações", async () => {
    const plan = parsePlanilhaTotal(PLANILHA());
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "reversivel.xlsx", byEmail: dono.email })
    );
    expect(r.clientesCriados).toBe(1);
    expect(r.pagamentosCriados).toBe(2); // jan + recuperação de março

    const antes = await asOwner(dono, async () =>
      prisma.client.findFirst({ where: { document: DOC }, select: { id: true } })
    );
    expect(antes).not.toBeNull();

    const rev = await asOwner(dono, async () => reverterLoteTotal(r.batchId));
    expect(rev.ok).toBe(true);
    if (!rev.ok) return;
    expect(rev.desfeitos["pagamentos"]).toBe(2);
    expect(rev.desfeitos["cobranças"]).toBe(3);
    expect(rev.desfeitos["clientes"]).toBe(1);

    // Nada do lote sobrou.
    const depois = await asOwner(dono, async () =>
      prisma.client.findFirst({ where: { document: DOC } })
    );
    expect(depois).toBeNull();
    const cobrancas = await runWithoutScope(async () =>
      prisma.billing.count({ where: { client: { document: DOC } } })
    );
    expect(cobrancas).toBe(0);

    // Reverter de novo não é permitido.
    const deNovo = await asOwner(dono, async () => reverterLoteTotal(r.batchId));
    expect(deNovo.ok).toBe(false);
  });

  it("cliente que JÁ existia (lote só atualizou) não é apagado pela reversão", async () => {
    const doc = "10.203.040/0001-55";
    await asOwner(dono, async () =>
      prisma.client.create({
        data: { name: `Veterano ${SUFIXO}`, document: doc, modality: "MRR", monthlyValue: 900, paymentDay: 5 },
      })
    );
    const plan = parsePlanilhaTotal(
      livro({
        CLIENTES: [
          [...COLUNAS_CLIENTES],
          [`Veterano ${SUFIXO}`, doc, "", "", "", "", "", "", "", "",
           "01/01/2026", "MRR", "900,00", "", "", "5", "", "", "", "Ativo", "", "", ""],
        ],
        MENSAL: [
          [...COLUNAS_MENSAL],
          ["2026-01", doc, "900,00", "Vencido", "", "", "", "", "", "", "", ""],
        ],
      })
    );
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "veterano.xlsx", byEmail: dono.email })
    );
    expect(r.clientesCriados).toBe(0);
    expect(r.clientesAtualizados).toBe(1);

    const rev = await asOwner(dono, async () => reverterLoteTotal(r.batchId));
    expect(rev.ok).toBe(true);
    if (!rev.ok) return;

    const sobrevive = await asOwner(dono, async () =>
      prisma.client.findFirst({ where: { document: doc } })
    );
    expect(sobrevive).not.toBeNull();
    expect(rev.naoDesfeitos.some((x) => x.entity === "cliente")).toBe(true);
  });
});
