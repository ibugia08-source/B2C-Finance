"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { askReason, confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL, parseBRL } from "@/lib/format";
import { criarOportunidadeAction, fecharVendaAction, moverEtapaAction } from "@/lib/actions/funil";
import { ETAPAS_DO_FUNIL, type EtapaDoFunil } from "@/lib/commercial/funil";
import type { ColunaDoFunil } from "@/lib/services/pipeline";

type Opcao = { id: string; name: string };

/**
 * O QUADRO.
 *
 * Arrastar é ATALHO, não caminho único (02 §7.9: "kanban tem select"). Todo
 * card tem um seletor de etapa que funciona no teclado e no toque — sem ele,
 * o funil seria a única tela do produto impossível de operar sem mouse, e a
 * pessoa que mais usa funil trabalha no celular.
 *
 * A movimentação é OTIMISTA (02 §7.7): o card muda de coluna na hora e volta
 * com o motivo se o servidor recusar. Esperar o servidor para ver o card
 * andar transforma a arrumação do quadro numa tarefa lenta, e quadro que dá
 * trabalho de arrumar para de refletir a realidade.
 */
export function QuadroDoFunil({
  colunas,
  agencias,
  ofertas,
  leads,
  podeOperar,
  podeGanhar,
}: {
  colunas: ColunaDoFunil[];
  agencias: Opcao[];
  ofertas: Opcao[];
  leads: { id: string; name: string; company: string | null }[];
  podeOperar: boolean;
  podeGanhar: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState(colunas);
  const [novo, setNovo] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => setEstado(colunas), [colunas]);

  function mover(id: string, para: EtapaDoFunil) {
    const origem = estado.find((c) => c.cards.some((x) => x.id === id));
    const card = origem?.cards.find((x) => x.id === id);
    if (!card || !origem || origem.id === para) return;

    const aplicar = (motivo?: string) =>
      start(async () => {
        const r = await moverEtapaAction(id, para, motivo);
        if (!r.ok) {
          setEstado(colunas); // volta ao que o servidor mandou
          return showUndoToast({ message: r.error });
        }
        router.refresh();
      });

    if (para === "GANHA") {
      // Ganhar é ENTREGAR PARA A OPERAÇÃO (01 §6.1), não só mudar de coluna:
      // cria/vincula o cliente, abre a relação, o termo, o onboarding, o
      // contrato rascunho e as cobranças. Por isso passa por outra ação.
      void (async () => {
        const ok = await confirmAction({
          title: `Fechar a venda “${card.titulo}”?`,
          description:
            "O cliente entra na carteira com relação, termo, implantação e contrato em rascunho. As cobranças de contrato fechado são geradas na hora.",
          confirmLabel: "Fechar venda",
        });
        if (!ok) return;
        retirar(id);
        start(async () => {
          const r = await fecharVendaAction(id);
          if (!r.ok) {
            setEstado(colunas);
            return showUndoToast({ message: r.error });
          }
          showUndoToast({
            message: r.pendencias.length
              ? `Venda fechada com pendências: ${r.pendencias.join("; ")}.`
              : r.billingIds.length
                ? `Venda fechada — ${r.billingIds.length} ${r.billingIds.length === 1 ? "cobrança gerada" : "cobranças geradas"}.`
                : "Venda fechada. A mensalidade entra no ciclo do mês.",
          });
          router.refresh();
        });
      })();
      return;
    }

    if (para === "PERDIDA") {
      void (async () => {
        const motivo = await askReason({
          title: `Marcar “${card.titulo}” como perdida?`,
          description: "O motivo fica registrado — é a informação que mais volta depois.",
          motivo: { label: "Por que perdemos?", minimo: 3 },
          confirmLabel: "Registrar perda",
          destructive: true,
        });
        if (!motivo) return;
        retirar(id);
        aplicar(motivo);
      })();
      return;
    }

    // Otimista: tira da coluna atual e põe na nova.
    setEstado((atual) =>
      atual.map((c) => {
        if (c.id === origem.id) return { ...c, cards: c.cards.filter((x) => x.id !== id) };
        if (c.id === para) return { ...c, cards: [{ ...card, stage: para }, ...c.cards] };
        return c;
      })
    );
    aplicar();
  }

  function retirar(id: string) {
    setEstado((atual) =>
      atual.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== id) }))
    );
  }

  return (
    <>
      {podeOperar ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Nova oportunidade
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {estado.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => {
              if (!podeOperar) return;
              e.preventDefault();
              setSobre(col.id);
            }}
            onDragLeave={() => setSobre((s) => (s === col.id ? null : s))}
            onDrop={() => {
              setSobre(null);
              if (arrastando) mover(arrastando, col.id);
              setArrastando(null);
            }}
            className={`rounded-lg border p-2.5 transition-colors ${
              sobre === col.id ? "border-brand bg-surface-sunken" : "bg-surface-sunken/40"
            }`}
          >
            <div className="mb-2">
              <p className="text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {col.titulo}
                <span className="ml-1.5 tabular-nums">{col.cards.length}</span>
              </p>
              <p className="text-caption tabular-nums text-muted-foreground">
                {formatBRL(col.total)}
              </p>
            </div>

            <ul className="space-y-2">
              {col.cards.map((c) => (
                <li
                  key={c.id}
                  draggable={podeOperar}
                  onDragStart={() => setArrastando(c.id)}
                  onDragEnd={() => setArrastando(null)}
                  className="rounded-md border bg-card p-2.5"
                >
                  <p className="truncate text-dense font-medium">{c.titulo}</p>
                  <p className="mt-0.5 truncate text-caption text-muted-foreground">
                    {[c.cliente, c.closer, c.agencia].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="tabular-nums text-dense font-medium">
                      {formatBRL(c.amount)}
                      <span className="ml-1 text-caption font-normal text-muted-foreground">
                        {c.modalidade}
                      </span>
                    </span>
                    {c.parada ? (
                      <Badge variant="warning">{c.diasNaEtapa}d parada</Badge>
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {c.diasNaEtapa}d
                      </span>
                    )}
                  </div>

                  {podeOperar ? (
                    <Select
                      aria-label={`Etapa de ${c.titulo}`}
                      className="mt-2 h-8 text-caption"
                      value={c.stage}
                      onChange={(e) => mover(c.id, e.target.value as EtapaDoFunil)}
                    >
                      {ETAPAS_DO_FUNIL.filter(
                        (e) => !e.terminal || e.id === "PERDIDA" || podeGanhar
                      ).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.titulo}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </li>
              ))}
              {col.cards.length === 0 ? (
                <li className="rounded-md border border-dashed p-3 text-center text-caption text-muted-foreground">
                  {col.saidaDaEtapa}
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>

      {novo ? (
        <DialogoDeOportunidade
          agencias={agencias}
          ofertas={ofertas}
          leads={leads}
          onFechar={() => setNovo(false)}
        />
      ) : null}
    </>
  );
}

function DialogoDeOportunidade({
  agencias,
  ofertas,
  leads,
  onFechar,
}: {
  agencias: Opcao[];
  ofertas: Opcao[];
  leads: { id: string; name: string; company: string | null }[];
  onFechar: () => void;
}) {
  const router = useRouter();
  const [titulo, setTitulo] = useState("");
  const [leadId, setLeadId] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [offerId, setOfferId] = useState("");
  const [closer, setCloser] = useState("");
  const [valor, setValor] = useState("");
  const [modalidade, setModalidade] = useState<"MRR" | "TCV">("MRR");
  const [meses, setMeses] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova oportunidade</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="op-titulo">O que está sendo vendido</Label>
            <Input
              id="op-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Gestão de tráfego — Padaria do Bairro"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-lead">Lead</Label>
            <Select id="op-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Sem lead vinculado</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.company ? `${l.company} — ${l.name}` : l.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="op-valor">Valor</Label>
              <Input
                id="op-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="1500,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-modalidade">Modalidade</Label>
              <Select
                id="op-modalidade"
                value={modalidade}
                onChange={(e) => setModalidade(e.target.value as "MRR" | "TCV")}
              >
                <option value="MRR">Mensalidade (MRR)</option>
                <option value="TCV">Contrato fechado (TCV)</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="op-closer">Closer</Label>
              <Input id="op-closer" value={closer} onChange={(e) => setCloser(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-meses">Prazo (meses)</Label>
              <Input
                id="op-meses"
                inputMode="numeric"
                value={meses}
                onChange={(e) => setMeses(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="op-agencia">Agência</Label>
              <Select id="op-agencia" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">—</option>
                {agencias.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-oferta">Plano</Label>
              <Select id="op-oferta" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                <option value="">—</option>
                {ofertas.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </div>
          </div>

          {erro ? <p className="text-dense text-destructive">{erro}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErro(null);
                const r = await criarOportunidadeAction({
                  title: titulo,
                  leadId: leadId || null,
                  agencyId: agencyId || null,
                  offerId: offerId || null,
                  closer: closer || null,
                  amount: parseBRL(valor) || 0,
                  modality: modalidade,
                  months: meses ? Number(meses) : null,
                });
                if (!r.ok) return setErro(r.error);
                showUndoToast({ message: "Oportunidade criada." });
                onFechar();
                router.refresh();
              })
            }
          >
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
