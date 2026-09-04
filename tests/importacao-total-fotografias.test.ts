import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import {
  asOwner, createOwner, destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { parsePlanilhaTotal } from "@/lib/imports/total/parser";
import { aplicarPlanilhaTotal } from "@/lib/imports/total/aplicar";
import { gerarSnapshotsDeImportacao } from "@/lib/imports/total/snapshots";
import { snapshotDe } from "@/lib/snapshots/engine";
import { lerFotografia } from "@/lib/snapshots/read";
import { COLUNAS_CLIENTES, COLUNAS_MENSAL } from "@/lib/imports/total/modelo";
import { toCompetence } from "@/lib/competence";

/**
 * F1.14 (v2) — a importação gera fotografias REBUILT_FROM_MIGRATION e a
 * máquina do tempo passa a responder o mês importado, com a origem visível.
 */

let dono: TestOwner;
const SUFIXO = Math.random().toString(36).slice(2, 7);
const DOC = "44.555.666/0001-77";
// Fotografia é APPEND-ONLY (gatilho bloqueia DELETE) — cada execução usa um
// ANO próprio para o resíduo de um run não contaminar o seguinte.
const ANO = 1991 + Math.floor(Math.random() * 30);
const COMP1 = `${ANO}-01`;
const COMP2 = `${ANO}-02`;

function livro(abas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [nome, aoa] of Object.entries(abas))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa as any[][]), nome);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

beforeAll(async () => { dono = await createOwner(); });
afterAll(async () => { await destroyOwner(dono); });

describe("F1.14 — fotografias da importação", () => {
  it("gera REBUILT para mês encerrado, pula o corrente, e o leitor cai para a importada", async () => {
    const plan = parsePlanilhaTotal(
      livro({
        CLIENTES: [
          [...COLUNAS_CLIENTES],
          [`Cliente Foto ${SUFIXO}`, DOC, "", "", "", "", "", "", "", "",
           "05/01/" + String(ANO), "MRR", "1000,00", "", "", "8", "", "", "", "Ativo", "", "", ""],
        ],
        MENSAL: [
          [...COLUNAS_MENSAL],
          [COMP1, DOC, "1000,00", "Pago", "08/01/" + String(ANO), "", "", "", "", "", "", ""],
        ],
      })
    );
    const r = await asOwner(dono, async () =>
      aplicarPlanilhaTotal(plan, { fileName: "foto.xlsx", byEmail: dono.email })
    );

    const agora = new Date();
    const corrente = toCompetence(agora.getFullYear(), agora.getMonth() + 1);
    const fotos = await asOwner(dono, async () =>
      gerarSnapshotsDeImportacao([COMP1 as any, corrente], r.batchId)
    );
    expect(fotos.geradas.map((g) => g.competencia)).toEqual([COMP1]);
    expect(fotos.puladas).toHaveLength(1);
    expect(fotos.puladas[0].motivo).toContain("mês em andamento");

    // O leitor da máquina do tempo agora responde janeiro — como IMPORTADA.
    const foto = await asOwner(dono, async () => lerFotografia(COMP1));
    expect(foto).not.toBeNull();
    expect(foto!.origem).toBe("IMPORTADA");
    expect(foto!.nomeDoLote).toContain("importacao-");
    expect(foto!.checksum).toBeTruthy();
  });

  it("fechamento NATIVO prevalece sobre a importada, e importar de novo pula o mês", async () => {
    // Cria uma fotografia nativa "por fora" (como um fechamento real faria).
    const snapImportada = await runWithoutScope(async () =>
      prisma.snapshot.findFirstOrThrow({
        where: { competence: COMP1, kind: "REBUILT_FROM_MIGRATION" },
        orderBy: { createdAt: "desc" },
      })
    );
    await runWithoutScope(async () =>
      prisma.snapshot.create({
        data: {
          workspaceId: snapImportada.workspaceId,
          competence: COMP1,
          kind: "NATIVE",
          version: 999, // ano exclusivo do run — não colide
          closedBy: "teste@b2c.local",
          areas: snapImportada.areas as any,
          checksum: snapImportada.checksum,
          checksumByArea: snapImportada.checksumByArea as any,
          sourceCutoffAt: new Date(),
          schemaVersion: snapImportada.schemaVersion,
          metricRegistryVersion: snapImportada.metricRegistryVersion,
        },
      })
    );

    const escolhida = await asOwner(dono, async () => snapshotDe(COMP1));
    expect(escolhida?.kind).toBe("NATIVE");

    // ClosingPeriod CLOSED faz a geração PULAR o mês (o definitivo prevalece).
    const ws = await runWithoutScope(async () =>
      prisma.workspace.findFirstOrThrow({ select: { id: true } })
    );
    const periodo = await runWithoutScope(async () =>
      prisma.closingPeriod.create({
        data: { workspaceId: ws.id, competence: COMP2, state: "CLOSED", closedAt: new Date(), closedBy: "teste@b2c.local" },
      })
    );
    try {
      const fotos = await asOwner(dono, async () =>
        gerarSnapshotsDeImportacao([COMP2 as any], "lote-teste")
      );
      expect(fotos.geradas).toHaveLength(0);
      expect(fotos.puladas[0].motivo).toContain("fechamento nativo");
    } finally {
      await runWithoutScope(async () =>
        prisma.closingPeriod.delete({ where: { id: periodo.id } })
      );
    }
  });
});
