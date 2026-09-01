import { PageHeader } from "@/components/page-header";
import { getViewer } from "@/lib/auth/viewer";
import {
  ensureNotificacoesDoDia, notificacoesDe,
} from "@/lib/services/notifications";
import { PainelDeNotificacoes } from "./painel";

/**
 * CENTRAL DE NOTIFICAÇÕES (F1.19 · ref. 02 §4.7).
 *
 * Abrir a central GERA as notificações do dia (com trava de frequência) —
 * "acontecem sozinhas" sem depender de agendador externo. As regras
 * anti-fadiga moram no serviço: agrupamento por origem e teto diário com
 * resumo do excedente.
 */
export const dynamic = "force-dynamic";

export default async function NotificacoesPage() {
  const viewer = await getViewer("/notificacoes");
  await ensureNotificacoesDoDia();
  const { lista, naoLidas } = await notificacoesDe(viewer.id);

  return (
    <div>
      <PageHeader
        title="Notificações"
        description="O que precisa da sua atenção, agrupado por origem — uma linha por assunto por dia"
      />
      <PainelDeNotificacoes
        naoLidas={naoLidas}
        itens={lista.map((l) => ({ ...l, quando: l.quando.toISOString() }))}
      />
    </div>
  );
}
