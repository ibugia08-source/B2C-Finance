import { defineEndpoint } from "@/lib/api/http";
import pacote from "../../../../../../integrations/n8n/knowledge/b2c-finance-knowledge.json";

/**
 * GET /api/v1/knowledge/documents — a BASE DE CONHECIMENTO do agente, pronta
 * para indexar (docs/AI_AGENT_KNOWLEDGE.md): documentos + trechos com
 * metadados, gerados por `npm run n8n:build` a partir de
 * integrations/n8n/knowledge/manifest.json.
 *
 * RAG = conhecimento e documentação; API = dados atuais. Nada aqui é dado do
 * workspace — é a mesma documentação para qualquer dono, e por isso não
 * depende do escopo do Prisma. O workflow knowledge-ingest.json lê esta rota
 * e grava no vector store; o agente consulta o vector store só para
 * conceitos e procedimentos.
 */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint({ action: "knowledge.documents", scope: "knowledge.read" }, async () => ({
  data: pacote,
  meta: { version: pacote.version, documents: pacote.documentos.length, chunks: pacote.trechos.length },
}));
