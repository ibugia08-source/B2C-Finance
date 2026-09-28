import { defineEndpoint } from "@/lib/api/http";

/** GET /api/v1/health — a API está no ar e esta credencial vale. Sem scope. */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint({ action: "health", audit: false, scope: null }, async () => ({
  // Chegar aqui já provou banco no ar: a autenticação leu a conta de serviço.
  data: { status: "ok", apiVersion: "v1", database: "ok" },
}));
