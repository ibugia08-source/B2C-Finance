import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Download do DOCX original de um modelo de contrato (só do próprio dono). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  // findUnique é pós-filtrado por dono → modelo de outro owner volta null.
  const template = await prisma.contractTemplate.findUnique({ where: { id: params.id } });
  if (!template) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

  try {
    const buf = await getFile(template.filePath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": template.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(template.originalFileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo indisponível no storage" }, { status: 404 });
  }
}
