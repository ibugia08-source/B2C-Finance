"use client";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RuleRowActions } from "./row-actions";
import { Search, Wand2 } from "lucide-react";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";

export function RulesList({
  rules,
  categories,
  cards,
}: {
  rules: any[];
  categories: any[];
  cards: any[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rules.filter((r) => {
      if (status === "ativa" && !r.active) return false;
      if (status === "inativa" && r.active) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.descriptionContains ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rules, query, status]);

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
                placeholder="Nome ou texto da condição…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="w-full sm:w-44">
            <Label className="text-xs">Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="ativa">Ativas</option>
              <option value="inativa">Inativas</option>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground sm:pb-2 whitespace-nowrap">
            {filtered.length} de {rules.length}
          </div>
        </div>

        <div className="hidden md:block border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Prioridade</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Condição</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    <Wand2 className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    {rules.length === 0
                      ? "Nenhuma regra cadastrada ainda."
                      : "Nenhuma regra encontrada com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="outline">{r.priority}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.descriptionContains && (
                        <Badge variant="secondary" className="font-normal">
                          contém “{r.descriptionContains}”
                        </Badge>
                      )}
                      {r.amountGreaterThan != null && (
                        <Badge variant="secondary" className="font-normal">valor &gt; {r.amountGreaterThan}</Badge>
                      )}
                      {r.amountLessThan != null && (
                        <Badge variant="secondary" className="font-normal">valor &lt; {r.amountLessThan}</Badge>
                      )}
                      {!r.descriptionContains && r.amountGreaterThan == null && r.amountLessThan == null && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.category?.name && (
                        <Badge variant="default" className="font-normal">cat: {r.category.name}</Badge>
                      )}
                      {r.belongsTo && (
                        <Badge variant="outline" className="font-normal capitalize">{r.belongsTo}</Badge>
                      )}
                      {!r.category?.name && !r.belongsTo && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "secondary"}>
                      {r.active ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <RuleRowActions rule={r} categories={categories} cards={cards} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: cada regra vira um card */}
        <MobileCards className="p-0">
          {filtered.length === 0 ? (
            <MobileEmpty>
              {rules.length === 0
                ? "Nenhuma regra cadastrada ainda."
                : "Nenhuma regra encontrada com esse filtro."}
            </MobileEmpty>
          ) : (
            filtered.map((r) => (
              <MobileCard key={r.id}>
                <MobileCardHeader
                  title={r.name}
                  aside={
                    <Badge variant={r.active ? "success" : "secondary"}>
                      {r.active ? "Ativa" : "Inativa"}
                    </Badge>
                  }
                />
                <div className="space-y-1.5">
                  <Field label="Prioridade">
                    <Badge variant="outline">{r.priority}</Badge>
                  </Field>
                  <Field label="Condição">
                    <span className="flex flex-wrap justify-end gap-1">
                      {r.descriptionContains && (
                        <Badge variant="secondary" className="font-normal">
                          contém “{r.descriptionContains}”
                        </Badge>
                      )}
                      {r.amountGreaterThan != null && (
                        <Badge variant="secondary" className="font-normal">valor &gt; {r.amountGreaterThan}</Badge>
                      )}
                      {r.amountLessThan != null && (
                        <Badge variant="secondary" className="font-normal">valor &lt; {r.amountLessThan}</Badge>
                      )}
                      {!r.descriptionContains && r.amountGreaterThan == null && r.amountLessThan == null && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </Field>
                  <Field label="Ação">
                    <span className="flex flex-wrap justify-end gap-1">
                      {r.category?.name && (
                        <Badge variant="default" className="font-normal">cat: {r.category.name}</Badge>
                      )}
                      {r.belongsTo && (
                        <Badge variant="outline" className="font-normal capitalize">{r.belongsTo}</Badge>
                      )}
                      {!r.category?.name && !r.belongsTo && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </Field>
                </div>
                <MobileCardActions>
                  <RuleRowActions rule={r} categories={categories} cards={cards} />
                </MobileCardActions>
              </MobileCard>
            ))
          )}
        </MobileCards>
      </CardContent>
    </Card>
  );
}
