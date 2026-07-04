"use client";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CategoryRowActions } from "./row-actions";
import { Search, Tags } from "lucide-react";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";

export type CategoryRow = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  usage: number;
};

const KIND_LABEL: Record<string, string> = {
  despesa: "Despesa",
  receita: "Receita",
  mista: "Mista",
};

export function CategoriesList({ categories }: { categories: CategoryRow[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories.filter((c) => {
      if (kind && c.kind !== kind) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [categories, query, kind]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome da categoria…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="w-full sm:w-44">
            <Label className="text-xs">Tipo</Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Todos</option>
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
              <option value="mista">Mista</option>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground sm:pb-2 whitespace-nowrap">
            {filtered.length} de {categories.length}
          </div>
        </div>

        <div className="hidden md:block border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Transações</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    <Tags className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    {categories.length === 0
                      ? "Nenhuma categoria cadastrada ainda."
                      : "Nenhuma categoria encontrada com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block w-3.5 h-3.5 rounded-full ring-1 ring-black/10"
                        style={{ background: c.color ?? "#999" }}
                      />
                      {c.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{c.usage}</TableCell>
                  <TableCell className="text-right">
                    <CategoryRowActions category={c} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: cada categoria vira um card */}
        <MobileCards className="p-0">
          {filtered.length === 0 ? (
            <MobileEmpty>
              {categories.length === 0
                ? "Nenhuma categoria cadastrada ainda."
                : "Nenhuma categoria encontrada com esse filtro."}
            </MobileEmpty>
          ) : (
            filtered.map((c) => (
              <MobileCard key={c.id}>
                <MobileCardHeader
                  title={
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block w-3.5 h-3.5 rounded-full ring-1 ring-black/10"
                        style={{ background: c.color ?? "#999" }}
                      />
                      {c.name}
                    </span>
                  }
                  aside={<Badge variant="secondary">{KIND_LABEL[c.kind] ?? c.kind}</Badge>}
                />
                <div className="space-y-1.5">
                  <Field label="Transações">{c.usage}</Field>
                </div>
                <MobileCardActions>
                  <CategoryRowActions category={c} />
                </MobileCardActions>
              </MobileCard>
            ))
          )}
        </MobileCards>
      </CardContent>
    </Card>
  );
}
