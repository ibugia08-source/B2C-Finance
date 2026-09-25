import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/storage";
import { hasPermission } from "@/lib/permissions";

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

/**
 * Permissão que libera o download de cada tipo de arquivo. Antes só o ADMIN
 * baixava — e a tela mostrava o link para Gestor/Comercial/Closer, que
 * levavam 403. O escopo por dono continua vindo da extensão do Prisma
 * (findUnique é pós-filtrado por ownerId): arquivo de outro workspace = 404.
 */
export const FILE_DOWNLOAD_PERMISSION: Record<FileType, string> = {
  contrato: "contratos.baixar_contrato",
  documento: "clientes.anexar_documentos",
  modelo: "contratos.gerar_contrato",
};

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
  const permission = FILE_DOWNLOAD_PERMISSION[params.type];
  if (!user || !permission || !hasPermission(user, permission)) {
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
