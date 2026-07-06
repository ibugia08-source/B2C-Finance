import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Download do DOCX de um contrato gerado (só do próprio dono). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  const contract = await prisma.generatedContract.findUnique({ where: { id: params.id } });
  if (!contract) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });

  try {
    const buf = await getFile(contract.generatedFilePath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(contract.generatedFileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo indisponível no storage" }, { status: 404 });
  }
}
