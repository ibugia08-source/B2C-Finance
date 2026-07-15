import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateBR } from "@/lib/format";
import { Info, Empty } from "../../../shared-components";
import { ContactDialog, ContactActions } from "../../../contact-dialog";
import { CLIENT_STATUS_LABEL, clientStatusVariant } from "../../../../_meta";

export default async function DadosPrincipaisPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
    },
  });

  if (!client) notFound();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-5 space-y-2">
          <h2 className="font-semibold mb-2">Dados cadastrais</h2>
          <Info label="Status">
            <Badge variant={clientStatusVariant(client.status)}>
              {CLIENT_STATUS_LABEL[client.status]}
            </Badge>
          </Info>
          <Info label="Razão social">{client.legalName ?? "—"}</Info>
          <Info label="CNPJ / CPF">{client.document ?? "—"}</Info>
          <Info label="Segmento">{client.segment ?? "—"}</Info>
          <Info label="Cidade/UF">
            {client.city ? `${client.city}${client.state ? `/${client.state}` : ""}` : "—"}
          </Info>
          <Info label="Origem">{client.origin ?? "—"}</Info>
          <Info label="Resp. comercial">{client.salesOwner ?? "—"}</Info>
          <Info label="Resp. operacional">{client.opsOwner ?? "—"}</Info>
          <Info label="Dia de pagamento">
            {client.paymentDay != null ? `dia ${client.paymentDay}` : "—"}
          </Info>
          <Info label="Entrada">
            {client.startedAt ? formatDateBR(client.startedAt) : "—"}
          </Info>
          {client.churnedAt && (
            <Info label="Saída (churn)">{formatDateBR(client.churnedAt)}</Info>
          )}
          <Info label="E-mail">{client.email ?? "—"}</Info>
          <Info label="WhatsApp">{client.phone ?? "—"}</Info>
          {client.tags.length > 0 && (
            <Info label="Tags">
              <span className="flex flex-wrap gap-1 justify-end">
                {client.tags.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </span>
            </Info>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Contatos</h2>
            <ContactDialog clientId={client.id} />
          </div>
          {client.contacts.length === 0 ? (
            <Empty>Nenhum contato cadastrado ainda.</Empty>
          ) : (
            <div className="space-y-3">
              {client.contacts.map((ct) => (
                <div
                  key={ct.id}
                  className="flex items-start justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      {ct.name}{" "}
                      {ct.isPrimary && <Badge variant="default">principal</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[ct.role, ct.email, ct.phone].filter(Boolean).join(" · ") ||
                        "—"}
                    </p>
                  </div>
                  <ContactActions contact={ct} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
