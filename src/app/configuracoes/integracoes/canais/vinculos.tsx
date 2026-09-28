"use client";
import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatInstantBR, formatInstantTimeBR } from "@/lib/format";
import { desvincularCanalAction, reativarCanalAction } from "@/lib/actions/messaging-identities";
import { AVISOS_PROATIVOS, type AvisoProativo } from "@/lib/messaging/notifications";
import { EnviosDialog, type Envios } from "./envios-dialog";

export type VinculoRow = {
  id: string;
  canal: string;
  usuario: string;
  email: string;
  papel: string;
  usuarioAtivo: boolean;
  identificador: string;
  ativo: boolean;
  criadoEm: string;
  desativadoEm: string | null;
  ultimoUso: string | null;
  envios: Envios;
};

function resumoDosEnvios(e: Envios): string {
  const partes = [e.manha && "Manhã", e.noite && "Noite", ...e.avisos.map((a) => AVISOS_PROATIVOS[a as AvisoProativo]?.label)].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Nenhum";
}

export function VinculosCanais({ rows, gerencia }: { rows: VinculoRow[]; gerencia: boolean }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  function desvincular(r: VinculoRow) {
    start(async () => {
      const ok = await confirmAction({
        title: `Desvincular ${r.canal} ${r.identificador}?`,
        description: `Mensagens deste ${r.canal} deixam de ser atendidas na hora. O histórico fica guardado, e dá para reativar depois.`,
        confirmLabel: "Desvincular",
        destructive: true,
      });
      if (!ok) return;
      setErro(null);
      const res = await desvincularCanalAction(r.id);
      if (!res.ok) setErro(res.error);
    });
  }

  function reativar(r: VinculoRow) {
    start(async () => {
      setErro(null);
      const res = await reativarCanalAction(r.id);
      if (!res.ok) setErro(res.error);
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Nenhum canal vinculado"
        description={
          gerencia
            ? "Vincule o Telegram (ou WhatsApp) de cada pessoa da equipe para o agente saber quem está falando e o que ela pode ver."
            : "O administrador ainda não vinculou Telegram nem WhatsApp."
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
                <TableHead>Canal</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Vinculado em</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead>Envios</TableHead>
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
                  <TableCell>{r.canal}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.identificador}</TableCell>
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
                  <TableCell className="text-caption text-muted-foreground">{resumoDosEnvios(r.envios)}</TableCell>
                  {gerencia && (
                    <TableCell className="text-right">
                      {r.ativo ? (
                        <span className="inline-flex gap-2">
                          <EnviosDialog id={r.id} canal={r.canal} usuario={r.usuario} envios={r.envios} />
                          <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => desvincular(r)}>
                            Desvincular
                          </Button>
                        </span>
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
        Usuário restrito a uma agência ainda não é atendido pelo agente. Relatórios e avisos só chegam a quem estiver marcado em
        Envios.
      </p>
    </>
  );
}
