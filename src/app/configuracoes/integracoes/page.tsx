import { PageHeader } from "@/components/page-header";
import { requirePagePermission } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import { listarIntegracoes, podeGerenciarIntegracoes } from "@/lib/services/service-accounts";
import { IntegrationsPanel, type IntegracaoRow } from "./integrations-panel";
import { NovaIntegracaoDialog } from "./nova-integracao-dialog";

/**
 * CONFIGURAÇÕES → INTEGRAÇÕES → API (28/09/2026 — docs/API_AUTHENTICATION.md).
 *
 * Contas de serviço que acessam /api/v1 (n8n, agente de WhatsApp). Ver exige
 * `integracoes.visualizar`; criar, revogar e rotacionar, `integracoes.gerenciar`
 * (só o administrador). O token aparece uma única vez, no diálogo que o gerou.
 */
export const dynamic = "force-dynamic";

export default async function IntegracoesPage() {
  const viewer = await requirePagePermission("integracoes.visualizar", "/configuracoes/integracoes");
  const ctx = await domainContextFor(viewer);
  const [lista, gerencia] = [await listarIntegracoes(ctx), podeGerenciarIntegracoes(ctx)];
  const agora = Date.now();

  const rows: IntegracaoRow[] = lista.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    estado: i.status === "REVOKED" ? "revogada" : i.expiresAt && i.expiresAt.getTime() <= agora ? "expirada" : "ativa",
    tokenPrefix: i.tokenPrefix,
    scopes: i.scopes,
    createdAt: i.createdAt.toISOString(),
    lastUsedAt: i.lastUsedAt?.toISOString() ?? null,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    rotatedAt: i.rotatedAt?.toISOString() ?? null,
  }));

  return (
    <div>
      <PageHeader
        title="Integrações · API"
        description="Chaves com que sistemas externos, como o n8n, acessam o B2C Finance pela API."
        actions={gerencia ? <NovaIntegracaoDialog /> : undefined}
      />
      <IntegrationsPanel rows={rows} gerencia={gerencia} />
    </div>
  );
}
