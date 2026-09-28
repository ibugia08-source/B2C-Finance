import { PageHeader } from "@/components/page-header";
import { requirePagePermission } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import { podeGerenciarIntegracoes } from "@/lib/services/service-accounts";
import { listarIdentidades, usuariosDoWorkspace } from "@/lib/services/messaging-identities";
import { ROLE_LABEL, isKnownRole } from "@/lib/permissions";
import { ROTULO_DO_CANAL, formatarIdentificador, type Canal } from "@/lib/messaging/channels";
import { IntegracoesTabs } from "../tabs";
import { VinculosCanais, type VinculoRow } from "./vinculos";
import { VincularDialog } from "./vincular-dialog";

/**
 * CONFIGURAÇÕES → INTEGRAÇÕES → CANAIS (28/09/2026; Telegram em 29/09/2026).
 *
 * Qual Telegram (User ID) ou WhatsApp (número) é de qual usuário. É o que o
 * agente usa para saber quem está falando e o que essa pessoa pode ver (o
 * RBAC dela). Identificador sem vínculo ativo não é atendido.
 */
export const dynamic = "force-dynamic";

const papel = (r: string) => (isKnownRole(r) ? ROLE_LABEL[r] : r);

export default async function CanaisPage() {
  const viewer = await requirePagePermission("integracoes.visualizar", "/configuracoes/integracoes/canais");
  const ctx = await domainContextFor(viewer);
  const gerencia = podeGerenciarIntegracoes(ctx);
  const [vinculos, usuarios] = await Promise.all([listarIdentidades(ctx), usuariosDoWorkspace(ctx.ownerId)]);

  const rows: VinculoRow[] = vinculos.map((v) => ({
    id: v.id,
    canal: ROTULO_DO_CANAL[v.channel as Canal] ?? v.channel,
    usuario: v.user.name,
    email: v.user.email,
    papel: papel(v.user.role),
    usuarioAtivo: v.user.active,
    identificador: formatarIdentificador(v.channel as Canal, v.externalIdentifier, v.metadata as { username?: string } | null),
    ativo: v.isActive,
    criadoEm: v.createdAt.toISOString(),
    desativadoEm: v.deactivatedAt?.toISOString() ?? null,
    ultimoUso: v.lastResolvedAt?.toISOString() ?? null,
    envios: { manha: v.receiveMorningReport, noite: v.receiveEveningReport, avisos: v.notificationEvents },
  }));
  const opcoes = usuarios.filter((u) => u.active).map((u) => ({ id: u.id, label: `${u.name} · ${papel(u.role)}` }));

  return (
    <div>
      <PageHeader
        title="Integrações · API"
        description="Telegram e WhatsApp vinculados a usuários: o agente só atende quem está aqui, com as permissões de cada um."
        actions={gerencia ? <VincularDialog usuarios={opcoes} /> : undefined}
      />
      <IntegracoesTabs ativa="canais" />
      <VinculosCanais rows={rows} gerencia={gerencia} />
    </div>
  );
}
