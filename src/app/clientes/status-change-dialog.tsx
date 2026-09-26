"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { showUndoToast } from "@/components/undo-toast";
import { bulkChangeClientStatusAction, changeClientStatusAction } from "@/lib/actions/client-status";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL } from "./_meta";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const fmt = (d: string) => (d.length === 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
const mesAno = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`;

/**
 * ALTERAR STATUS COM VIGÊNCIA (26/09/2026).
 *
 * Substitui o select que trocava o status do cliente "para sempre": aqui a
 * mudança tem INÍCIO. Olhando outubro, a sugestão é 01/10 — setembro fica
 * como estava. Na competência em curso a escolha entre "hoje" e "início do
 * mês" é explícita (nunca decidida em silêncio). Data futura = alteração
 * PROGRAMADA: o status de hoje não muda até lá.
 *
 * `today` vem do servidor (calendário da Bahia) — o relógio do navegador
 * não decide que dia é hoje.
 */
export function StatusChangeDialog({
  open,
  onOpenChange,
  clientIds,
  clientName,
  currentStatus,
  competence,
  today,
  initialStatus,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientIds: string[];
  /** Nome (1 cliente) — em massa, o título mostra a quantidade. */
  clientName?: string;
  /** Status do cliente na competência em exibição (1 cliente). */
  currentStatus?: string | null;
  /** Competência em exibição, "YYYY-MM". */
  competence: string;
  /** Hoje, "YYYY-MM-DD" (servidor). */
  today: string;
  initialStatus?: string;
  onDone?: () => void;
}) {
  const bulk = clientIds.length > 1;
  const atual = today.slice(0, 7);
  const inicioComp = `${competence}-01`;
  const emCurso = competence === atual;

  const [status, setStatus] = useState(initialStatus ?? "");
  const [modo, setModo] = useState<"hoje" | "inicio" | "data">(emCurso ? "hoje" : "inicio");
  const [data, setData] = useState(emCurso ? today : inicioComp);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const enviando = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStatus(initialStatus ?? "");
    setModo(emCurso ? "hoje" : "inicio");
    setData(emCurso ? today : inicioComp);
    setReason("");
    setError(null);
  }, [open, initialStatus, emCurso, today, inicioComp]);

  const vigencia = modo === "hoje" ? today : modo === "inicio" ? inicioComp : data;
  const tipo = !/^\d{4}-\d{2}-\d{2}$/.test(vigencia)
    ? null
    : vigencia > today
      ? "FUTURA"
      : vigencia < `${atual}-01`
        ? "RETROATIVA"
        : "ATUAL";

  const mensagem = useMemo(() => {
    if (!tipo) return null;
    const base = bulk
      ? `Esta alteração será aplicada a ${clientIds.length} clientes a partir de ${mesAno(vigencia)} (${fmt(vigencia)}). Os períodos anteriores serão preservados.`
      : `Esta alteração passará a valer a partir de ${mesAno(vigencia)} (${fmt(vigencia)}). Os períodos anteriores serão preservados.`;
    return base;
  }, [tipo, bulk, clientIds.length, vigencia]);

  function enviar() {
    if (enviando.current || pending) return; // duplo clique não envia duas vezes
    if (!status) return setError("Escolha o novo status.");
    if (!tipo) return setError("Informe o início da vigência.");
    enviando.current = true;
    setError(null);
    start(async () => {
      try {
        if (bulk) {
          const r = await bulkChangeClientStatusAction({ ids: clientIds, status, effectiveFrom: vigencia, reason });
          if (!r.ok) return setError(String(r.error));
          const falhas = r.falhas?.length ?? 0;
          showUndoToast({
            message:
              `${r.alterados} cliente(s) com ${CLIENT_STATUS_LABEL[status as keyof typeof CLIENT_STATUS_LABEL]} a partir de ${fmt(vigencia)}.` +
              (falhas > 0 ? ` ${falhas} não puderam ser alterados: ${r.falhas![0].error}` : ""),
          });
        } else {
          const r = await changeClientStatusAction({ clientId: clientIds[0], status, effectiveFrom: vigencia, reason });
          if (!r.ok) return setError(String(r.error));
          showUndoToast({
            message: r.programada
              ? `Alteração programada: ${CLIENT_STATUS_LABEL[status as keyof typeof CLIENT_STATUS_LABEL]} a partir de ${fmt(vigencia)}. O status atual continua até lá.`
              : r.aviso ?? `Status alterado a partir de ${fmt(vigencia)}.`,
          });
        }
        onOpenChange(false);
        onDone?.();
      } finally {
        enviando.current = false;
      }
    });
  }

  const opcoes = CLIENT_STATUSES.filter((s) => s !== "LEAD" || s === currentStatus);

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {bulk ? `Alterar status de ${clientIds.length} clientes` : `Alterar status${clientName ? ` — ${clientName}` : ""}`}
          </DialogTitle>
          <DialogDescription>
            O status tem vigência: vale a partir da data escolhida, sem reescrever os meses anteriores.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!bulk && currentStatus !== undefined && (
            <p className="text-sm text-muted-foreground">
              Status em {mesAno(inicioComp)}:{" "}
              <strong className="text-foreground">
                {currentStatus ? CLIENT_STATUS_LABEL[currentStatus as keyof typeof CLIENT_STATUS_LABEL] ?? currentStatus : "sem registro"}
              </strong>
            </p>
          )}

          <div>
            <Label htmlFor="novo-status">Novo status</Label>
            <Select id="novo-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={pending}>
              <option value="">Selecione…</option>
              {opcoes.map((s) => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Início da vigência</legend>
            {emCurso ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="modo" checked={modo === "hoje"} onChange={() => setModo("hoje")} disabled={pending} />
                  A partir de hoje ({fmt(today)})
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="modo" checked={modo === "inicio"} onChange={() => setModo("inicio")} disabled={pending} />
                  A partir do início da competência ({fmt(inicioComp)})
                </label>
              </>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="modo" checked={modo === "inicio"} onChange={() => setModo("inicio")} disabled={pending} />
                A partir de {fmt(inicioComp)} (início de {mesAno(inicioComp)})
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="modo" checked={modo === "data"} onChange={() => setModo("data")} disabled={pending} />
              Outra data
            </label>
            {modo === "data" && (
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={pending} aria-label="Data de início da vigência" />
            )}
          </fieldset>

          <div>
            <Label htmlFor="motivo-status">Motivo (opcional)</Label>
            <Textarea id="motivo-status" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending} maxLength={500} />
          </div>

          {mensagem && (
            <div className="rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2 text-sm">
              <p>{mensagem}</p>
              {tipo === "FUTURA" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Alteração programada: até {fmt(vigencia)} o status atual continua valendo — rotina, recebimentos e
                  indicadores de hoje não mudam. Dá para cancelar antes da data.
                </p>
              )}
              {tipo === "RETROATIVA" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Alteração retroativa: muda a carteira de {mesAno(vigencia)} em diante. Exige permissão específica e
                  competência aberta.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={pending || !status}>
            {pending ? "Salvando…" : bulk ? `Aplicar a ${clientIds.length} clientes` : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Célula de status da carteira: o status NA COMPETÊNCIA em exibição + o
 * aviso discreto da próxima alteração programada. Clique abre o diálogo
 * com vigência — nunca troca o status "global" direto.
 */
export function ClientStatusCell({
  clientId,
  clientName,
  status,
  scheduled,
  competence,
  today,
  pillClass,
  compact = false,
}: {
  clientId: string;
  clientName: string;
  status: string | null;
  scheduled: { status: string; from: string } | null;
  competence: string;
  today: string;
  pillClass: (s: string) => string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rotulo = status ? CLIENT_STATUS_LABEL[status as keyof typeof CLIENT_STATUS_LABEL] ?? status : "Sem registro";
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Status de ${clientName}: ${rotulo}. Alterar status`}
        title={status ? undefined : "Sem status registrado nesta competência (antes da entrada ou histórico a revisar)"}
        className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition hover:opacity-80 ${
          status ? pillClass(status) : "border-dashed text-muted-foreground"
        }`}
      >
        {rotulo}
      </button>
      {scheduled && !compact && (
        <span
          className="text-[11px] leading-tight text-info-ink"
          title="Alteração programada — o status atual vale até a véspera"
        >
          Programado: {CLIENT_STATUS_LABEL[scheduled.status as keyof typeof CLIENT_STATUS_LABEL] ?? scheduled.status} em{" "}
          {fmt(scheduled.from)}
        </span>
      )}
      <StatusChangeDialog
        open={open}
        onOpenChange={setOpen}
        clientIds={[clientId]}
        clientName={clientName}
        currentStatus={status}
        competence={competence}
        today={today}
      />
    </div>
  );
}
