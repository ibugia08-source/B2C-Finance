import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/storage";

type FileType = "contrato" | "documento" | "modelo";

interface FileMetadata {
  filePath: string;
  fileName: string;
  mimeType: string;
}

async function getFileMetadata(type: FileType, id: string): Promise<FileMetadata | null> {
  if (type === "contrato") {
    const contract = await prisma.generatedContract.findUnique({ where: { id } });
    if (!contract) return null;
    return {
      filePath: contract.generatedFilePath,
      fileName: contract.generatedFileName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (type === "documento") {
    const doc = await prisma.clientDocument.findUnique({ where: { id } });
    if (!doc) return null;
    return {
      filePath: doc.filePath,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
    };
  }

  if (type === "modelo") {
    const template = await prisma.contractTemplate.findUnique({ where: { id } });
    if (!template) return null;
    return {
      filePath: template.filePath,
      fileName: template.originalFileName,
      mimeType: template.mimeType,
    };
  }

  return null;
}

const typeNames: Record<FileType, string> = {
  contrato: "Contrato",
  documento: "Documento",
  modelo: "Modelo",
};

export async function handleFileDownload(
  _req: NextRequest,
  params: { type: FileType; id: string }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const metadata = await getFileMetadata(params.type, params.id);
  if (!metadata) {
    return NextResponse.json(
      { error: `${typeNames[params.type]} não encontrado` },
      { status: 404 }
    );
  }

  try {
    const buf = await getFile(metadata.filePath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": metadata.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(metadata.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo indisponível no storage" }, { status: 404 });
  }
}
