import { NextRequest } from "next/server";
import { handleFileDownload } from "@/app/api/arquivos/_shared/handler";

export const dynamic = "force-dynamic";

/** Download do DOCX de um contrato gerado (só do próprio dono). */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return handleFileDownload(req, { type: "contrato", id: params.id });
}
