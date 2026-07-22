import { NextRequest } from "next/server";
import { handleFileDownload } from "@/app/api/arquivos/_shared/handler";

export const dynamic = "force-dynamic";

/** Download de um documento anexado ao cliente (só do próprio dono). */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return handleFileDownload(req, { type: "documento", id: params.id });
}
