import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Download de um documento anexado ao cliente (só do próprio dono). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  const doc = await prisma.clientDocument.findUnique({ where: { id: params.id } });
  if (!doc) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  try {
    const buf = await getFile(doc.filePath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo indisponível no storage" }, { status: 404 });
  }
}
