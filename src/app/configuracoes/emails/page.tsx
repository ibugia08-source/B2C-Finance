import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/viewer";
import { EMAILS_DE_EXEMPLO } from "@/lib/email/messages";

/**
 * PRÉVIA DOS E-MAILS (F3.12 · ref. 02 §7.8).
 *
 * A tela existe para o texto ser LIDO antes de ser enviado. Um e-mail
 * transacional é revisado uma vez e enviado mil — e o lugar onde o tom errado
 * aparece não é no código, é lendo a mensagem inteira, na largura em que ela
 * chega.
 *
 * Cada prévia roda em iframe com `sandbox` vazio: o HTML de e-mail traz
 * estilo inline e tabelas de layout, e deixá-lo herdar o CSS do produto
 * mostraria uma coisa aqui e outra na caixa de entrada.
 */
export const dynamic = "force-dynamic";

export default async function PreviaDeEmailsPage() {
  await requirePagePermission("configuracoes.visualizar");

  return (
    <div>
      <PageHeader
        title="E-mails do sistema"
        description="O que o cliente e a equipe recebem — no tema da marca, para ser lido antes de ser enviado"
      />

      <p className="mb-4 text-dense text-muted-foreground">
        Estes textos são montados pelo sistema e entregues pela fila de envio.
        Enquanto não houver provedor de e-mail configurado, eles existem, são
        revisáveis e não saem daqui.
      </p>

      <div className="space-y-4">
        {EMAILS_DE_EXEMPLO.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-0">
              <div className="border-b border-border-soft px-4 py-3">
                <p className="text-body font-medium">{e.nome}</p>
                <p className="mt-0.5 text-dense text-muted-foreground">
                  Assunto: {e.email.assunto}
                </p>
                <p className="text-caption text-muted-foreground">
                  Prévia na caixa de entrada: {e.email.preheader}
                </p>
              </div>
              <iframe
                title={`Prévia do e-mail: ${e.nome}`}
                sandbox=""
                srcDoc={e.email.html}
                className="h-[440px] w-full border-0"
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
