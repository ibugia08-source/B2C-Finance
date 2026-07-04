// Importa o arquivo interno do pdf-parse para evitar o bloco de "debug mode"
// no index.js (que tenta abrir ./test/data/05-versions-space.pdf quando
// module.parent é falsy — caso comum em bundlers).
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { tryNubankLike } from "./parsers/nubank-like";
import { tryItauLike } from "./parsers/itau-like";
import { tryInterLike } from "./parsers/inter-like";
import { tryGenericStatement } from "./parsers/generic-statement";
import { detectIssuer } from "./detect-issuer";
import type { PdfParseResult } from "./types";

export type { PdfParseResult, PdfTransaction } from "./types";

export type PdfDiagnostics = {
  layout: string;
  issuer?: string | null;
  totalLines: number;
  recognized: number;
  sampleLines: string[]; // primeiras linhas do texto extraído
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  firstBytesHex?: string;
  firstBytesAscii?: string;
  startsWithPdfMagic?: boolean;
  technicalError?: string;
};

export type PdfErrorReason =
  | "EMPTY_FILE"
  | "NOT_A_PDF"
  | "PARSE_FAIL"
  | "NO_TEXT"
  | "NO_LAYOUT";

export class PdfImportError extends Error {
  diagnostics?: PdfDiagnostics;
  constructor(
    public reason: PdfErrorReason,
    message: string,
    diagnostics?: PdfDiagnostics
  ) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

function bufferDiagnostics(
  buffer: Buffer | null,
  meta: { name?: string; size?: number; type?: string }
): Pick<PdfDiagnostics, "fileName" | "fileSize" | "fileType" | "firstBytesHex" | "firstBytesAscii" | "startsWithPdfMagic"> {
  const head = buffer ? buffer.subarray(0, 20) : Buffer.alloc(0);
  const hex = head.toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
  const ascii = head
    .toString("latin1")
    .replace(/[^\x20-\x7e]/g, ".");
  return {
    fileName: meta.name,
    fileSize: meta.size,
    fileType: meta.type,
    firstBytesHex: hex,
    firstBytesAscii: ascii,
    startsWithPdfMagic: head.subarray(0, 4).toString("ascii") === "%PDF",
  };
}

/**
 * Pré-valida e extrai texto do PDF. Joga PdfImportError com diagnóstico
 * detalhado em qualquer falha.
 */
export async function parseInvoicePdf(
  buffer: Buffer,
  meta: { name?: string; size?: number; type?: string } = {}
): Promise<PdfParseResult & { diagnostics: PdfDiagnostics }> {
  const baseDiag = bufferDiagnostics(buffer, meta);

  // 1. tamanho zero
  if (!buffer || buffer.length === 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[pdf-import] arquivo vazio", baseDiag);
    }
    throw new PdfImportError(
      "EMPTY_FILE",
      "O arquivo enviado está vazio. Tente fazer o download novamente.",
      {
        layout: "unknown",
        totalLines: 0,
        recognized: 0,
        sampleLines: [],
        ...baseDiag,
      }
    );
  }

  // 2. localizar o cabeçalho %PDF. Alguns exports de banco vêm com lixo no
  //    início (bytes nulos, BOM, espaços) antes do %PDF — nesse caso cortamos
  //    o lixo e usamos o PDF de verdade. Só rejeitamos se não houver %PDF algum.
  const pdfStart = buffer.indexOf("%PDF");
  if (pdfStart === -1) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[pdf-import] cabeçalho %PDF não encontrado", baseDiag);
    }
    throw new PdfImportError(
      "NOT_A_PDF",
      "O arquivo enviado não parece ser um PDF válido. Verifique se o download foi feito corretamente.",
      {
        layout: "unknown",
        totalLines: 0,
        recognized: 0,
        sampleLines: [],
        ...baseDiag,
      }
    );
  }
  // Buffer saneado: começa exatamente no %PDF (corta qualquer lixo anterior).
  const pdfBuffer = pdfStart === 0 ? buffer : buffer.subarray(pdfStart);
  if (pdfStart > 0 && process.env.NODE_ENV !== "production") {
    console.info(`[pdf-import] %PDF encontrado no offset ${pdfStart}; lixo inicial removido`);
  }

  // 3. tenta extrair texto
  let parsed;
  try {
    parsed = await pdfParse(pdfBuffer);
  } catch (e: any) {
    const technical = e?.message ?? String(e);
    if (process.env.NODE_ENV !== "production") {
      console.error("[pdf-import] pdf-parse falhou:", technical, baseDiag);
    }
    throw new PdfImportError(
      "PARSE_FAIL",
      "Não conseguimos extrair o conteúdo deste PDF. Tente exportar o extrato em CSV/XLSX ou baixar o PDF novamente pelo app/banco.",
      {
        layout: "unknown",
        totalLines: 0,
        recognized: 0,
        sampleLines: [],
        ...baseDiag,
        technicalError: technical,
      }
    );
  }

  const text = (parsed.text ?? "").trim();
  if (!text) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[pdf-import] PDF sem texto extraível", baseDiag);
    }
    throw new PdfImportError(
      "NO_TEXT",
      "Este PDF parece ser escaneado/imagem. Exporte o extrato em CSV/XLSX ou use um PDF digital.",
      {
        layout: "unknown",
        totalLines: 0,
        recognized: 0,
        sampleLines: [],
        ...baseDiag,
      }
    );
  }

  const allLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const candidates = [tryNubankLike, tryItauLike, tryInterLike];
  let best: PdfParseResult | null = null;
  for (const fn of candidates) {
    const r = fn(text);
    if (r && (!best || r.transactions.length > best.transactions.length)) {
      best = r;
    }
  }
  // fallback genérico
  const generic = tryGenericStatement(text);
  if (!best || generic.transactions.length > best.transactions.length) {
    best = generic;
  }

  const issuer = detectIssuer(text);
  if (best) best.issuer = issuer;

  const recognized = best?.transactions.length ?? 0;
  const diagnostics: PdfDiagnostics = {
    layout: best?.layout ?? "unknown",
    issuer: issuer?.label ?? null,
    totalLines: allLines.length,
    recognized,
    sampleLines: allLines.slice(0, 30),
    ...baseDiag,
  };

  if (!best || recognized === 0) {
    throw new PdfImportError(
      "NO_LAYOUT",
      "Não conseguimos reconhecer o layout deste extrato. Tente exportar em CSV/XLSX ou ajustar manualmente.",
      diagnostics
    );
  }

  return { ...best, diagnostics };
}
