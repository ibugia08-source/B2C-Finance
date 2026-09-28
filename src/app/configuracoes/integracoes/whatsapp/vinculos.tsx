"use client";
import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatInstantBR, formatInstantTimeBR } from "@/lib/format";
import { desvincularWhatsAppAction, reativarWhatsAppAction } from "@/lib/actions/messaging-identities";

export type VinculoRow = {
  id: string;
  usuario: string;
  email: string;
  papel: string;
  usuarioAtivo: boolean;
  telefone: string;
  ativo: boolean;
  criadoEm: string;
  desativadoEm: string | null;
  ultimoUso: string | null;
};

export function VinculosWhatsApp({ rows, gerencia }: { rows: VinculoRow[]; gerencia: boolean }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  function desvincular(r: VinculoRow) {
    start(async () => {
      const ok = await confirmAction({
        title: `Desvincular ${r.telefone}?`,
        description: `Mensagens deste número deixam de ser atendidas na hora. O histórico fica guardado, e dá para reativar depois.`,
        confirmLabel: "Desvincular",
        destructive: true,
      });
      if (!ok) return;
      setErro(null);
      const res = await desvincularWhatsAppAction(r.id);
      if (!res.ok) setErro(res.error);
    });
  }

  function reativar(r: VinculoRow) {
    start(async () => {
      setErro(null);
      const res = await reativarWhatsAppAction(r.id);
      if (!res.ok) setErro(res.error);
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Nenhum número vinculado"
        description={
          gerencia
            ? "Vincule o WhatsApp de cada pessoa da equipe para o agente saber quem está falando e o que ela pode ver."
            : "O administrador ainda não vinculou números de WhatsApp."
        }
      />
    );
  }

  return (
    <>
      {erro && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-dense text-danger-ink">
          {erro}
        </p>
      )}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Vinculado em</TableHead>
                <TableHead>Último uso</TableHead>
                {gerencia && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-medium">{r.usuario}</span>
                    <span className="block text-caption text-muted-foreground">
                      {r.papel}
                      {!r.usuarioAtivo && " · usuário inativo"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.telefone}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2 py-0.5 text-caption font-medium ${
                        r.ativo && r.usuarioAtivo ? "bg-success-soft text-success-ink" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.ativo ? (r.usuarioAtivo ? "Ativo" : "Sem atendimento") : "Desvinculado"}
                    </span>
                    {!r.ativo && r.desativadoEm && (
                      <span className="block text-caption text-muted-foreground">em {formatInstantBR(r.desativadoEm)}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatInstantBR(r.criadoEm)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.ultimoUso ? formatInstantTimeBR(r.ultimoUso) : "Nunca"}</TableCell>
                  {gerencia && (
                    <TableCell className="text-right">
                      {r.ativo ? (
                        <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => desvincular(r)}>
                          Desvincular
                        </Button>
                      ) : (
                        <Button type="button" variant="outline" size="sm" disabled={pendente || !r.usuarioAtivo} onClick={() => reativar(r)}>
                          Reativar
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-muted-foreground">
        O agente atende com as permissões do usuário (papel e ajustes da matriz de permissões), limitadas às da integração.
        Usuário restrito a uma agência ainda não é atendido pelo agente.
      </p>
    </>
  );
}
