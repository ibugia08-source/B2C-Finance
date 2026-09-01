"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { showUndoToast } from "@/components/undo-toast";
import { criarLeadAction, converterLeadAction } from "@/lib/actions/funil";
import { analisarConversaoAction } from "@/lib/actions/leads-analise";
import type { AnaliseDeConversao } from "@/lib/services/leads";

type Opcao = { id: string; name: string };

export type LeadDaLista = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  document: string | null;
  niche: string | null;
  channel: string | null;
  campaign: string | null;
  sdr: string | null;
  status: string;
  indicadoPor: string | null;
  solicitadoPor: string | null;
  createdAt: string;
  convertedClientId: string | null;
  agencia: string | null;
};

const ROTULO_STATUS: Record<string, { texto: string; variante: "success" | "warning" | "outline" | "secondary" }> = {
  NEW: { texto: "novo", variante: "outline" },
  CONTACTED: { texto: "contatado", variante: "outline" },
  QUALIFIED: { texto: "qualificado", variante: "warning" },
  SCHEDULED: { texto: "reunião marcada", variante: "warning" },
  CONVERTED: { texto: "virou cliente", variante: "success" },
  LOST: { texto: "perdido", variante: "secondary" },
};

/**
 * A lista de leads e a conversão em duas etapas.
 *
 * DUAS ETAPAS de propósito: primeiro o sistema mostra o que encontrou
 * (mesmo documento, parecidos), depois a pessoa confirma. Converter num
 * clique só seria mais rápido até o dia em que duplicasse um cliente da
 * carteira — e desfazer isso depois custa horas de conferência.
 */
export function ListaDeLeads({
  leads,
  agencias,
  podeOperar,
  podeConverter,
  indicadores,
}: {
  leads: LeadDaLista[];
  agencias: Opcao[];
  podeOperar: boolean;
  podeConverter: boolean;
  indicadores: { nome: string; quantidade: number }[];
}) {
  const [novo, setNovo] = useState(false);
  const [convertendo, setConvertendo] = useState<LeadDaLista | null>(null);

  return (
    <>
      {podeOperar ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Novo lead
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="p-0">
            {leads.length === 0 ? (
              <p className="px-3.5 py-8 text-center text-dense text-muted-foreground">
                Nenhum lead cadastrado ainda.
              </p>
            ) : (
              <ul className="divide-y divide-border-soft">
                {leads.map((l) => {
                  const visual = ROTULO_STATUS[l.status] ?? ROTULO_STATUS.NEW;
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">
                          {l.company ? `${l.company} — ${l.name}` : l.name}
                        </p>
                        <p className="mt-0.5 truncate text-caption text-muted-foreground">
                          {[
                            l.phone,
                            l.niche,
                            l.channel,
                            l.sdr ? `SDR ${l.sdr}` : null,
                            l.agencia,
                            l.indicadoPor ? `indicado por ${l.indicadoPor}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "sem outros dados"}
                        </p>
                      </div>
                      <Badge variant={visual.variante}>{visual.texto}</Badge>
                      {l.convertedClientId ? (
                        <Link
                          href={`/clientes/${l.convertedClientId}`}
                          className="text-dense text-brand hover:underline"
                        >
                          abrir cliente
                        </Link>
                      ) : podeConverter ? (
                        <Button variant="outline" size="sm" onClick={() => setConvertendo(l)}>
                          Converter
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3.5">
            <p className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Quem mais indica
            </p>
            {indicadores.length === 0 ? (
              <p className="text-dense text-muted-foreground">
                Ninguém registrado ainda. Preencher “indicado por” é o que
                transforma o boca a boca em canal medido.
              </p>
            ) : (
              <ul className="space-y-1">
                {indicadores.map((i) => (
                  <li key={i.nome} className="flex justify-between text-dense">
                    <span className="min-w-0 truncate">{i.nome}</span>
                    <span className="tabular-nums text-muted-foreground">{i.quantidade}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {novo ? <DialogoDeLead agencias={agencias} onFechar={() => setNovo(false)} /> : null}
      {convertendo ? (
        <DialogoDeConversao lead={convertendo} onFechar={() => setConvertendo(null)} />
      ) : null}
    </>
  );
}

function DialogoDeLead({ agencias, onFechar }: { agencias: Opcao[]; onFechar: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: "", company: "", phone: "", email: "", document: "", niche: "",
    channel: "", campaign: "", sdr: "", indicadoPor: "", solicitadoPor: "", agencyId: "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((a) => ({ ...a, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Campo id="l-nome" label="Contato" value={f.name} onChange={set("name")} />
          <Campo id="l-empresa" label="Empresa" value={f.company} onChange={set("company")} />
          <Campo id="l-tel" label="Telefone" value={f.phone} onChange={set("phone")} />
          <Campo id="l-doc" label="CNPJ ou CPF" value={f.document} onChange={set("document")} />
          <Campo id="l-nicho" label="Nicho" value={f.niche} onChange={set("niche")} />
          <Campo id="l-canal" label="Canal" value={f.channel} onChange={set("channel")} />
          <Campo id="l-camp" label="Campanha" value={f.campaign} onChange={set("campaign")} />
          <Campo id="l-sdr" label="SDR" value={f.sdr} onChange={set("sdr")} />
          <Campo id="l-ind" label="Indicado por" value={f.indicadoPor} onChange={set("indicadoPor")} />
          <Campo id="l-sol" label="Solicitado por" value={f.solicitadoPor} onChange={set("solicitadoPor")} />
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="l-agencia">Agência que vai atender</Label>
            <Select id="l-agencia" value={f.agencyId} onChange={set("agencyId")}>
              <option value="">Ainda não definida</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
        </div>

        {erro ? <p className="text-dense text-destructive">{erro}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErro(null);
                const r = await criarLeadAction({
                  name: f.name,
                  company: f.company || null,
                  phone: f.phone || null,
                  email: f.email || null,
                  document: f.document || null,
                  niche: f.niche || null,
                  channel: f.channel || null,
                  campaign: f.campaign || null,
                  sdr: f.sdr || null,
                  indicadoPor: f.indicadoPor || null,
                  solicitadoPor: f.solicitadoPor || null,
                  agencyId: f.agencyId || null,
                });
                if (!r.ok) return setErro(r.error);
                showUndoToast({ message: "Lead cadastrado." });
                onFechar();
                router.refresh();
              })
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoDeConversao({
  lead,
  onFechar,
}: {
  lead: LeadDaLista;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [analise, setAnalise] = useState<AnaliseDeConversao | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Carrega a análise ao abrir. Efeito e não inicializador de estado: o
  // inicializador roda durante a renderização, e disparar requisição de lá é
  // como a mesma consulta sai duas vezes no modo estrito do React.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await analisarConversaoAction(lead.id);
      if (vivo) setAnalise(r);
    })();
    return () => {
      vivo = false;
    };
  }, [lead.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Converter “{lead.company || lead.name}” em cliente</DialogTitle>
        </DialogHeader>

        {!analise ? (
          <p className="text-dense text-muted-foreground">Conferindo a carteira…</p>
        ) : analise.mesmoDocumento ? (
          <p className="text-dense">
            Este documento já é do cliente <strong>{analise.mesmoDocumento.name}</strong>.
            {analise.desfechoPrevisto === "REATIVADO"
              ? " Ele está como saído — a conversão vai reativá-lo na mesma ficha, com o histórico inteiro."
              : " A conversão vai ligar o lead a ele, sem criar cadastro novo."}
          </p>
        ) : analise.sugestoes.length > 0 ? (
          <div className="space-y-2">
            <p className="text-dense">
              Nenhum cliente com este documento. Estes se parecem — confira antes
              de criar um cadastro novo:
            </p>
            <ul className="space-y-1">
              {analise.sugestoes.map((s) => (
                <li key={s.clientId} className="flex items-center gap-2 text-dense">
                  <input
                    type="radio"
                    id={`sug-${s.clientId}`}
                    name="sugestao"
                    className="h-4 w-4"
                    checked={escolhido === s.clientId}
                    onChange={() => setEscolhido(s.clientId)}
                  />
                  <label htmlFor={`sug-${s.clientId}`} className="min-w-0 flex-1 cursor-pointer truncate">
                    {s.nome}
                    <span className="ml-1.5 text-caption text-muted-foreground">{s.motivo}</span>
                  </label>
                </li>
              ))}
              <li className="flex items-center gap-2 text-dense">
                <input
                  type="radio"
                  id="sug-nenhum"
                  name="sugestao"
                  className="h-4 w-4"
                  checked={escolhido === null}
                  onChange={() => setEscolhido(null)}
                />
                <label htmlFor="sug-nenhum" className="cursor-pointer">
                  Nenhum destes — criar cliente novo
                </label>
              </li>
            </ul>
          </div>
        ) : (
          <p className="text-dense">
            Ninguém parecido na carteira. Vai nascer um cliente novo, como
            prospect.
          </p>
        )}

        {erro ? <p className="text-dense text-destructive">{erro}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={pending || !analise}
            onClick={() =>
              start(async () => {
                setErro(null);
                const r = await converterLeadAction(lead.id, escolhido);
                if (!r.ok) return setErro(r.error);
                showUndoToast({
                  message:
                    r.desfecho === "REATIVADO"
                      ? "Cliente reativado na ficha antiga."
                      : r.desfecho === "EXISTENTE"
                        ? "Lead ligado ao cliente existente."
                        : "Cliente criado.",
                });
                onFechar();
                router.refresh();
              })
            }
          >
            Converter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  id, label, value, onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={onChange as any} />
    </div>
  );
}
