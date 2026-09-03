import { prisma } from "@/lib/prisma";

/**
 * FILA DE REVISÃO DA IMPORTAÇÃO (F1.21 · ref. 03 §3.3).
 *
 * A fila existe porque as duas saídas fáceis são ruins. Recusar a linha
 * duvidosa faz a pessoa perder o trabalho de 300 linhas por causa de 4.
 * Deixar passar calado faz o dado duvidoso virar número oficial — e ninguém
 * revisa o que não sabe que precisa de revisão.
 *
 * A linha ENTRA, e entra marcada, com a linha crua guardada ao lado para
 * quem for conferir.
 */

export type ItemRevisao = {
  id: string;
  entity: string;
  entityId: string | null;
  sourceRow: number;
  motivo: string | null;
  confianca: number;
  quando: Date;
  arquivo: string | null;
  /** O nome mais reconhecível dentro da linha crua. */
  rotulo: string;
};

/** Melhor rótulo humano que a linha crua oferece. */
function rotuloDa(raw: any): string {
  if (!raw || typeof raw !== "object") return "(linha sem identificação)";
  for (const campo of ["name", "clientName", "description", "title", "email"]) {
    const v = raw[campo];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "(linha sem identificação)";
}

export async function filaDeRevisao(limite = 100): Promise<ItemRevisao[]> {
  const rows = await prisma.importedRecord.findMany({
    where: { reviewStatus: "PENDENTE" },
    orderBy: [{ createdAt: "desc" }, { sourceRow: "asc" }],
    take: limite,
    select: {
      id: true, entity: true, entityId: true, sourceRow: true, raw: true,
      reviewReason: true, confidence: true, createdAt: true,
      batch: { select: { fileName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityId: r.entityId,
    sourceRow: r.sourceRow,
    motivo: r.reviewReason,
    confianca: r.confidence,
    quando: r.createdAt,
    arquivo: r.batch?.fileName ?? null,
    rotulo: rotuloDa(r.raw),
  }));
}

/**
 * Marca a pendência como tratada.
 *
 * RESOLVIDO = fui lá e arrumei. DESCARTADO = olhei e está certo assim.
 * São coisas diferentes e ficam gravadas diferentes: daqui a seis meses,
 * "por que este cliente está sem valor?" tem resposta.
 */
export async function encerrarPendencia(
  id: string,
  como: "RESOLVIDO" | "DESCARTADO",
  quem: string | null
): Promise<void> {
  await prisma.importedRecord.update({
    where: { id },
    data: { reviewStatus: como, resolvedAt: new Date(), resolvedBy: quem },
  });
}

/** Proveniência de um registro: de qual arquivo e de qual linha ele veio. */
export async function proveniencia(entity: string, entityId: string) {
  return prisma.importedRecord.findFirst({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    select: {
      sourceRow: true, sourceSystem: true, confidence: true, raw: true,
      createdAt: true, batch: { select: { fileName: true, createdAt: true } },
    },
  });
}
