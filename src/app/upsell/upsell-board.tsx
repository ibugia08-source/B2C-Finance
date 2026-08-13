"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Trash2, GripVertical } from "lucide-react";
import { setUpsellStatus, deleteUpsell } from "@/lib/actions/upsells";
import { showUndoToast } from "@/components/undo-toast";
import { UpsellDialog } from "./upsell-dialog";
import { KANBAN_COLUMNS, UPSELL_STATUS_LABEL } from "./_meta";

type Opt = { id: string; name: string };

export type BoardUpsell = {
  id: string;
  clientId: string;
  clientName: string;
  title: string | null;
  value: number;
  responsible: string | null;
  status: string;
  expectedCloseAt: string | null; // ISO
  closedAt: string | null; // ISO
  serviceNames: string[];
  targetName: string | null;
  notes: string | null;
  serviceId: string | null;
  offerId: string | null;
  services: { serviceId: string; unitPrice: number }[];
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : null;

/**
 * KANBAN DE UPSELL — as 4 etapas do funil em colunas; cards arrastáveis
 * (desktop) com select de etapa como fallback (mobile/touch). Soltar em
 * "Upsell vendido" abre o pop-up de lançamento nos recebimentos (mês atual
 * ou outro). Movimentação otimista com refresh do servidor ao concluir.
 */
export function UpsellBoard({
  upsells,
  clients,
  services,
  offers,
  canEdit,
  canSell,
  canDelete,
}: {
  upsells: BoardUpsell[];
  clients: Opt[];
  services: Opt[];
  offers: Opt[];
  canEdit: boolean;
  canSell: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(upsells);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [sellFor, setSellFor] = useState<BoardUpsell | null>(null);
  const [, start] = useTransition();

  useEffect(() => setItems(upsells), [upsells]);

  const byColumn = useMemo(() => {
    const map = new Map<string, BoardUpsell[]>();
    for (const col of KANBAN_COLUMNS) map.set(col.key, []);
    for (const u of items) {
      const col =
        KANBAN_COLUMNS.find((c) => (c.statuses as string[]).includes(u.status)) ??
        KANBAN_COLUMNS[0];
      map.get(col.key)!.push(u);
    }
    return map;
  }, [items]);

  function applyStatus(u: BoardUpsell, status: string) {
    setItems((cur) => cur.map((it) => (it.id === u.id ? { ...it, status } : it)));
    start(async () => {
      const res = await setUpsellStatus(u.id, status);
      if (!res.ok) {
        setItems((cur) =>
          cur.map((it) => (it.id === u.id ? { ...it, status: u.status } : it))
        );
        alert(res.error);
        return;
      }
      showUndoToast({
        message: `${u.clientName}: movido para ${UPSELL_STATUS_LABEL[status as keyof typeof UPSELL_STATUS_LABEL] ?? status}.`,
        onUndo: () => setUpsellStatus(u.id, u.status),
      });
      router.refresh();
    });
  }

  function moveTo(u: BoardUpsell, colKey: string) {
    if (u.status === colKey) return;
    if (colKey === "WON") {
      if (!canSell) return;
      setSellFor(u);
      return;
    }
    if (!canSell) return; // mover etapa usa a mesma permissão de decidir o funil
    applyStatus(u, colKey);
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {KANBAN_COLUMNS.map((col) => {
          const colItems = byColumn.get(col.key) ?? [];
          const colTotal = colItems.reduce((s, u) => s + u.value, 0);
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.key);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const id = e.dataTransfer.getData("text/plain") || dragId;
                const u = items.find((it) => it.id === id);
                if (u) moveTo(u, col.key);
                setDragId(null);
              }}
              className={`rounded-2xl border bg-card/60 p-2.5 transition-colors ${
                overCol === col.key ? "border-primary/60 bg-primary/5" : ""
              }`}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </p>
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                  {colItems.length}
                </span>
              </div>
              <p className="mb-2 px-1 text-[11px] text-muted-foreground stat-number">
                {colTotal > 0 ? brl(colTotal) : "—"}
              </p>
              <div className="space-y-2 min-h-[80px]">
                {colItems.map((u) => (
                  <div
                    key={u.id}
                    draggable={canSell}
                    onDragStart={(e) => {
                      setDragId(u.id);
                      e.dataTransfer.setData("text/plain", u.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragId(null)}
                    className={`rounded-xl border bg-card p-3 shadow-sm ${
                      canSell ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragId === u.id ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <Link
                        href={`/clientes/${u.clientId}`}
                        className="font-medium text-sm hover:underline truncate"
                      >
                        {u.clientName}
                      </Link>
                      {canSell && (
                        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                    </div>
                    <p className="stat-number mt-0.5 text-base font-semibold">
                      {brl(u.value)}
                    </p>
                    {u.title && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {u.title}
                      </p>
                    )}
                    {(u.serviceNames.length > 0 || u.targetName) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(u.serviceNames.length > 0
                          ? u.serviceNames
                          : [u.targetName!]
                        ).map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate">{u.responsible ?? "—"}</span>
                      <span className="shrink-0">
                        {u.status === "PAUSED"
                          ? "pausado"
                          : u.closedAt
                            ? `fechado ${dateBR(u.closedAt)}`
                            : u.expectedCloseAt
                              ? `prev. ${dateBR(u.expectedCloseAt)}`
                              : ""}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-1">
                      {/* Fallback touch/mobile: mover por select */}
                      {canSell ? (
                        <Select
                          className="h-8 w-auto max-w-[60%] text-xs md:hidden"
                          value={
                            KANBAN_COLUMNS.find((c) =>
                              (c.statuses as string[]).includes(u.status)
                            )?.key ?? "OPPORTUNITY"
                          }
                          onChange={(e) => moveTo(u, e.target.value)}
                          aria-label={`Etapa de ${u.clientName}`}
                        >
                          {KANBAN_COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span />
                      )}
                      <div className="ml-auto flex gap-0.5">
                        {canEdit && (
                          <UpsellDialog
                            clients={clients}
                            services={services}
                            offers={offers}
                            initial={u}
                            trigger={
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Excluir"
                            onClick={() => {
                              if (!confirm("Excluir esta oportunidade de upsell?")) return;
                              start(async () => {
                                const res = await deleteUpsell(u.id);
                                if (!res.ok) alert(res.error);
                                else router.refresh();
                              });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {colItems.length === 0 && (
                  <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    {col.key === "OPPORTUNITY"
                      ? "Nenhuma oportunidade — cadastre pela ficha do cliente ou aqui."
                      : "Arraste um card para cá."}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sellFor && (
        <SellUpsellDialog
          upsell={sellFor}
          onClose={() => setSellFor(null)}
          onSold={(launched) => {
            const u = sellFor;
            setSellFor(null);
            setItems((cur) =>
              cur.map((it) => (it.id === u.id ? { ...it, status: "WON" } : it))
            );
            showUndoToast({
              message: `${u.clientName}: upsell vendido${launched ? " e lançado nos recebimentos" : ""}.`,
            });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Pop-up da venda: lançar (ou não) na lista de recebimentos e em qual mês. */
function SellUpsellDialog({
  upsell,
  onClose,
  onSold,
}: {
  upsell: BoardUpsell;
  onClose: () => void;
  onSold: (launched: boolean) => void;
}) {
  const now = new Date();
  const [launch, setLaunch] = useState(true);
  const [competence, setCompetence] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirmSale() {
    start(async () => {
      setError(null);
      const [y, m] = competence.split("-").map((v) => parseInt(v, 10));
      const res = await setUpsellStatus(upsell.id, "WON", {
        launchBilling: launch,
        month: m,
        year: y,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSold(launch);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upsell vendido 🎉</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{upsell.clientName}</span> —{" "}
          {upsell.title ?? upsell.serviceNames.join(", ") ?? "venda interna"} ·{" "}
          <span className="font-medium text-foreground">{brl(upsell.value)}</span>
        </p>
        <div className="grid gap-3">
          <div>
            <Label>Lançar na lista de recebimentos?</Label>
            <Select
              value={launch ? "1" : "0"}
              onChange={(e) => setLaunch(e.target.value === "1")}
            >
              <option value="1">Sim — criar a cobrança do upsell</option>
              <option value="0">Não — só marcar como vendido</option>
            </Select>
          </div>
          {launch && (
            <div>
              <Label>Em qual mês?</Label>
              <Input
                type="month"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A cobrança entra na Gestão do Mês escolhido e segue o fluxo
                normal (pago em 1 clique, inadimplência, métricas).
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmSale} disabled={pending}>
            {pending ? "Salvando…" : "Confirmar venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
