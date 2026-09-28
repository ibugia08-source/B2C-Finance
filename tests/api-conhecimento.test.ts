import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { createOwner, destroyOwner, type TestOwner } from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";
import { criarIntegracao } from "@/lib/services/service-accounts";
import { SCOPE_REQUIRES_PERMISSIONS } from "@/lib/api/scopes";
import * as rota from "@/app/api/v1/knowledge/documents/route";
import pacote from "../integrations/n8n/knowledge/b2c-finance-knowledge.json";

/**
 * GET /api/v1/knowledge/documents — base de conhecimento do agente para
 * indexar. Documentação (igual para todos), atrás de token e do scope
 * knowledge.read; nenhum dado de workspace.
 */

let A: TestOwner;
let comScope: string;
let semScope: string;
const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});
async function chave(scopes: string[]) {
  const r = await criarIntegracao({ ownerId: A.id, principal: admin(A) }, { name: `rag-${randomUUID().slice(0, 6)}`, scopes, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  return r.token;
}
const get = async (token?: string) => {
  const res = await rota.GET(new Request("http://localhost/api/v1/knowledge/documents", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  A = await createOwner();
  comScope = await chave(["knowledge.read"]);
  semScope = await chave(["clients.read"]);
});
afterAll(async () => destroyOwner(A));

describe("GET /knowledge/documents", () => {
  it("com knowledge.read devolve o pacote versionado (documentos + trechos)", async () => {
    const r = await get(comScope);
    expect(r.status).toBe(200);
    expect(r.body.data.version).toBe(pacote.version);
    expect(r.body.data.trechos).toHaveLength(pacote.trechos.length);
    expect(r.body.meta).toMatchObject({ version: pacote.version, documents: pacote.documentos.length, chunks: pacote.trechos.length });
  });

  it("sem token = 401; sem o scope = 403", async () => {
    expect((await get()).status).toBe(401);
    const r = await get(semScope);
    expect(r.status).toBe(403);
    expect(r.body.error.scope).toBe("knowledge.read");
  });

  it("é da integração (não delegável a usuário)", () => {
    expect(SCOPE_REQUIRES_PERMISSIONS["knowledge.read"]).toBeUndefined();
  });
});
