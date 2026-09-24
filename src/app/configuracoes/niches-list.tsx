"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Merge, Pencil, Search, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { NicheDialog } from "./niche-dialog";
import { excluirNicho, mesclarNichos } from "@/lib/actions/niches";

export type NicheRow = { id: string; name: string; usage: number };

/**
 * Catálogo de nichos em Configurações. Quem não é ADMIN vê a lista e os
 * usos, sem botões: o nicho é categoria da plataforma, cadastrado uma vez.
 */
export function NichesList({
  niches,
  semNicho,
  isAdmin,
}: {
  niches: NicheRow[];
  /** Clientes ainda sem nicho no cadastro. */
  semNicho: number;
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? niches.filter((n) => n.name.toLowerCase().includes(q)) : niches;
  }, [niches, query]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Label className="text-xs" htmlFor="nichos-busca">Buscar nicho</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                id="nichos-busca"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome do nicho…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="text-xs text-muted-foreground sm:pb-2 whitespace-nowrap">
            {filtered.length} de {niches.length} · {semNicho} cliente(s) sem nicho
          </div>
        </div>

        <div className="hidden md:block border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nicho</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                {isAdmin && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 3 : 2} className="text-center text-muted-foreground py-10">
                    <Layers className="h-6 w-6 mx-auto mb-2 opacity-40" aria-hidden />
                    {niches.length === 0
                      ? "Nenhum nicho cadastrado ainda."
                      : "Nenhum nicho encontrado com essa busca."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{n.usage}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <NicheRowActions niche={n} all={niches} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <MobileCards className="p-0">
          {filtered.length === 0 ? (
            <MobileEmpty>
              {niches.length === 0 ? "Nenhum nicho cadastrado ainda." : "Nenhum nicho encontrado."}
            </MobileEmpty>
          ) : (
            filtered.map((n) => (
              <MobileCard key={n.id}>
                <MobileCardHeader title={n.name} />
                <div className="space-y-1.5">
                  <Field label="Clientes">{n.usage}</Field>
                </div>
                {isAdmin && (
                  <MobileCardActions>
                    <NicheRowActions niche={n} all={niches} />
                  </MobileCardActions>
                )}
              </MobileCard>
            ))
          )}
        </MobileCards>
      </CardContent>
    </Card>
  );
}

function NicheRowActions({ niche, all }: { niche: NicheRow; all: NicheRow[] }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [mesclando, setMesclando] = useState(false);
  const [destino, setDestino] = useState("");
  const outros = all.filter((n) => n.id !== niche.id);

  async function excluir() {
    const ok = await confirmAction({
      title: `Excluir o nicho ${niche.name}?`,
      description:
        niche.usage > 0
          ? `${niche.usage} cliente(s) usam este nicho e ficarão "Sem nicho". Se a ideia é juntar com outro, use Mesclar.`
          : "Nenhum cliente usa este nicho.",
      confirmLabel: "Excluir nicho",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      setErro(null);
      const r = await excluirNicho(niche.id);
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  async function mesclar() {
    if (!destino) return;
    const alvo = outros.find((n) => n.id === destino);
    const ok = await confirmAction({
      title: `Mesclar ${niche.name} em ${alvo?.name ?? "outro nicho"}?`,
      description: `${niche.usage} cliente(s) passam para "${alvo?.name}" e o nicho "${niche.name}" deixa de existir.`,
      confirmLabel: "Mesclar",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      setErro(null);
      const r = await mesclarNichos(niche.id, destino);
      if (r.ok) {
        setMesclando(false);
        router.refresh();
      } else setErro(r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {erro && (
        <span role="alert" className="mr-2 text-caption text-danger-ink">
          {erro}
        </span>
      )}
      {mesclando ? (
        <>
          <Select
            aria-label={`Mesclar ${niche.name} em`}
            className="h-8 text-xs min-w-[150px]"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
          >
            <option value="">Mesclar em…</option>
            {outros.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </Select>
          <Button size="sm" className="h-8 text-xs" disabled={!destino || pendente} onClick={mesclar}>
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setMesclando(false)}>
            Cancelar
          </Button>
        </>
      ) : (
        <>
          <NicheDialog
            initial={niche}
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Renomear nicho ${niche.name}`}>
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
            }
          />
          {outros.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Mesclar nicho ${niche.name} em outro`}
              onClick={() => setMesclando(true)}
            >
              <Merge className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Excluir nicho ${niche.name}`}
            disabled={pendente}
            onClick={excluir}
          >
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
          </Button>
        </>
      )}
    </div>
  );
}
