import { PageHeader } from "@/components/page-header";
import { requirePagePermission } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import { podeGerenciarIntegracoes } from "@/lib/services/service-accounts";
import { listarIdentidades, usuariosDoWorkspace } from "@/lib/services/messaging-identities";
import { ROLE_LABEL, isKnownRole } from "@/lib/permissions";
import { formatarTelefone } from "@/lib/messaging/phone";
import { IntegracoesTabs } from "../tabs";
import { VinculosWhatsApp, type VinculoRow } from "./vinculos";
import { VincularDialog } from "./vincular-dialog";

/**
 * CONFIGURAÇÕES → INTEGRAÇÕES → WHATSAPP (28/09/2026).
 *
 * Qual número de WhatsApp é de qual usuário. É o que o agente usa para saber
 * quem está falando e o que essa pessoa pode ver (o RBAC dela). Número sem
 * vínculo ativo não é atendido.
 */
export const dynamic = "force-dynamic";

const papel = (r: string) => (isKnownRole(r) ? ROLE_LABEL[r] : r);

export default async function WhatsAppPage() {
  const viewer = await requirePagePermission("integracoes.visualizar", "/configuracoes/integracoes/whatsapp");
  const ctx = await domainContextFor(viewer);
  const gerencia = podeGerenciarIntegracoes(ctx);
  const [vinculos, usuarios] = await Promise.all([listarIdentidades(ctx), usuariosDoWorkspace(ctx.ownerId)]);

  const rows: VinculoRow[] = vinculos.map((v) => ({
    id: v.id,
    usuario: v.user.name,
    email: v.user.email,
    papel: papel(v.user.role),
    usuarioAtivo: v.user.active,
    telefone: formatarTelefone(v.externalIdentifier),
    ativo: v.isActive,
    criadoEm: v.createdAt.toISOString(),
    desativadoEm: v.deactivatedAt?.toISOString() ?? null,
    ultimoUso: v.lastResolvedAt?.toISOString() ?? null,
  }));
  const opcoes = usuarios.filter((u) => u.active).map((u) => ({ id: u.id, label: `${u.name} · ${papel(u.role)}` }));

  return (
    <div>
      <PageHeader
        title="Integrações · API"
        description="Números de WhatsApp vinculados a usuários: o agente só atende quem está aqui, com as permissões de cada um."
        actions={gerencia ? <VincularDialog usuarios={opcoes} /> : undefined}
      />
      <IntegracoesTabs ativa="whatsapp" />
      <VinculosWhatsApp rows={rows} gerencia={gerencia} />
    </div>
  );
}
