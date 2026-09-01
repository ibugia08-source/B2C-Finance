"use client";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import {
  alternarRegraDeRateio, excluirRegraDeRateio, salvarRegraDeRateio,
} from "@/lib/actions/allocation-rules";

type Opcao = { id: string; name: string };
type Dimensao = "CLIENT" | "AGENCY" | "SERVICE";

export type RegraDeRateio = {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  descriptionContains: string | null;
  categoryId: string | null;
  dimensionType: Dimensao;
  dimensionId: string;
};

const ROTULO: Record<Dimensao, string> = {
  CLIENT: "Cliente",
  AGENCY: "Agência",
  SERVICE: "Serviço",
};

/**
 * REGRAS DE RATEIO (F3.4 · 02 §4.4: "regra por descrição de campanha").
 *
 * Uma regra manda 100% do que casa para UM dono. Não existe regra que divide
 * em percentuais, e a ausência é deliberada: campanha compartilhada entre dois
 * clientes é decisão de gente, tomada na tela de rateio. Uma divisão automática
 * de custo é o número que ninguém sabe defender quando o cliente pergunta.
 */
export function RegrasDeRateio({
  regras,
  categorias,
  clientes,
  agencias,
  servicos,
  podeEditar,
}: {
  regras: RegraDeRateio[];
  categorias: Opcao[];
  clientes: Opcao[];
  agencias: Opcao[];
  servicos: Opcao[];
  podeEditar: boolean;
}) {
  const [lista, setLista] = useState(regras);
  const [editando, setEditando] = useState<RegraDeRateio | null | undefined>(undefined);
  const [pending, start] = useTransition();

  const nomeDoDono = (r: RegraDeRateio) => {
    const fonte = r.dimensionType === "CLIENT" ? clientes : r.dimensionType === "AGENCY" ? agencias : servicos;
    return fonte.find((o) => o.id === r.dimensionId)?.name ?? "(removido)";
  };

  return (
    <>
      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Regras de rateio
        </h2>
        {podeEditar ? (
          <Button size="sm" onClick={() => setEditando(null)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Nova regra de rateio
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {lista.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-dense text-muted-foreground">
              Nenhuma regra de rateio. Elas reconhecem a campanha pelo nome no
              extrato e mandam o gasto para o cliente certo — o que sobra
              continua sendo distribuído à mão na tela de rateio.
            </p>
          ) : (
            <ul className="divide-y divide-border-soft">
              {lista.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{r.name}</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {r.descriptionContains
                        ? `descrição contém “${r.descriptionContains}”`
                        : "sem filtro de descrição"}
                      {" → "}
                      {ROTULO[r.dimensionType]}: {nomeDoDono(r)}
                    </p>
                  </div>
                  <Badge variant={r.active ? "success" : "outline"}>
                    {r.active ? "ativa" : "inativa"}
                  </Badge>
                  {podeEditar ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            await alternarRegraDeRateio(r.id, !r.active);
                            setLista((l) =>
                              l.map((x) => (x.id === r.id ? { ...x, active: !r.active } : x))
                            );
                          })
                        }
                      >
                        {r.active ? "Desativar" : "Ativar"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditando(r)}>
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        aria-label={`Excluir regra ${r.name}`}
                        disabled={pending}
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: `Excluir a regra “${r.name}”?`,
                            description:
                              "Os rateios que ela já criou continuam como estão — o que se perde é a regra.",
                            destructive: true,
                            confirmLabel: "Excluir",
                          });
                          if (!ok) return;
                          start(async () => {
                            await excluirRegraDeRateio(r.id);
                            setLista((l) => l.filter((x) => x.id !== r.id));
                            showUndoToast({ message: "Regra excluída." });
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editando !== undefined ? (
        <DialogoDaRegra
          inicial={editando}
          categorias={categorias}
          clientes={clientes}
          agencias={agencias}
          servicos={servicos}
          onFechar={() => setEditando(undefined)}
        />
      ) : null}
    </>
  );
}

function DialogoDaRegra({
  inicial,
  categorias,
  clientes,
  agencias,
  servicos,
  onFechar,
}: {
  inicial: RegraDeRateio | null;
  categorias: Opcao[];
  clientes: Opcao[];
  agencias: Opcao[];
  servicos: Opcao[];
  onFechar: () => void;
}) {
  const [dimensao, setDimensao] = useState<Dimensao>(inicial?.dimensionType ?? "CLIENT");
  const [dimensionId, setDimensionId] = useState(inicial?.dimensionId ?? "");
  const [nome, setNome] = useState(inicial?.name ?? "");
  const [texto, setTexto] = useState(inicial?.descriptionContains ?? "");
  const [categoria, setCategoria] = useState(inicial?.categoryId ?? "");
  const [prioridade, setPrioridade] = useState(String(inicial?.priority ?? 100));
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const opcoes = dimensao === "CLIENT" ? clientes : dimensao === "AGENCY" ? agencias : servicos;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{inicial ? "Editar regra de rateio" : "Nova regra de rateio"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="regra-nome">Nome</Label>
            <Input
              id="regra-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Campanha Padaria do Bairro"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="regra-texto">Quando a descrição contiver</Label>
            <Input
              id="regra-texto"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ex.: PADARIA-BAIRRO"
            />
            <p className="text-caption text-muted-foreground">
              É o nome que aparece no extrato do cartão de mídia.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="regra-categoria">Categoria (opcional)</Label>
              <Select
                id="regra-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              >
                <option value="">Qualquer</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regra-prioridade">Prioridade</Label>
              <Input
                id="regra-prioridade"
                type="number"
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="regra-dimensao">O gasto vai para</Label>
              <Select
                id="regra-dimensao"
                value={dimensao}
                onChange={(e) => {
                  setDimensao(e.target.value as Dimensao);
                  setDimensionId("");
                }}
              >
                {(["CLIENT", "AGENCY", "SERVICE"] as Dimensao[]).map((d) => (
                  <option key={d} value={d}>
                    {ROTULO[d]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regra-dono">Qual</Label>
              <Select
                id="regra-dono"
                value={dimensionId}
                onChange={(e) => setDimensionId(e.target.value)}
              >
                <option value="">Escolha…</option>
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {erro ? <p className="text-dense text-destructive">{erro}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErro(null);
                const r = await salvarRegraDeRateio({
                  id: inicial?.id,
                  name: nome,
                  priority: Number(prioridade) || 100,
                  active: inicial?.active ?? true,
                  descriptionContains: texto || null,
                  categoryId: categoria || null,
                  expenseType: null,
                  dimensionType: dimensao,
                  dimensionId,
                });
                if (!r.ok) return setErro(r.error);
                showUndoToast({ message: "Regra salva." });
                onFechar();
                location.reload();
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
