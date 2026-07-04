"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonRowActions } from "./row-actions";
import { formatBRL } from "@/lib/format";
import { ArrowRight, UserCheck, Search, Users } from "lucide-react";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";

export type PersonRow = {
  id: string;
  name: string;
  type: string;
  notes: string | null;
  userEmail: string | null;
  totalGasto: number;
  aReceber: number;
  pago: number;
};

const TYPE_LABEL: Record<string, string> = {
  pessoal: "Pessoal",
  empresa: "Empresa",
  terceiro: "Terceiro",
  familiar: "Familiar",
};

export function PeopleList({ people }: { people: PersonRow[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (type && p.type !== type) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.userEmail ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [people, query, type]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Barra de busca/filtro */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome ou e-mail…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="w-full sm:w-48">
            <Label className="text-xs">Tipo</Label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Todos</option>
              <option value="pessoal">Pessoal</option>
              <option value="empresa">Empresa</option>
              <option value="terceiro">Terceiro</option>
              <option value="familiar">Familiar</option>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground sm:pb-2 whitespace-nowrap">
            {filtered.length} de {people.length}
          </div>
        </div>

        {/* Tabela (desktop) */}
        <div className="hidden md:block border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Usuário vinculado</TableHead>
                <TableHead className="text-right">Total gasto</TableHead>
                <TableHead className="text-right">Devendo</TableHead>
                <TableHead className="text-right">Já pago</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    <Users className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    {people.length === 0
                      ? "Nenhuma pessoa cadastrada ainda."
                      : "Nenhuma pessoa encontrada com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((p) => (
                <TableRow key={p.id} className="group">
                  <TableCell className="font-medium">
                    <Link href={`/pessoas/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{TYPE_LABEL[p.type] ?? p.type}</Badge>
                  </TableCell>
                  <TableCell>
                    {p.userEmail ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm">
                        <UserCheck className="h-3.5 w-3.5" />
                        {p.userEmail}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatBRL(p.totalGasto)}</TableCell>
                  <TableCell className="text-right">
                    {p.aReceber > 0 ? (
                      <Badge variant="warning">{formatBRL(p.aReceber)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">{formatBRL(0)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-emerald-600">{formatBRL(p.pago)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2 items-center">
                      <Link href={`/pessoas/${p.id}`}>
                        <Button size="sm" variant="outline">
                          Ver detalhes <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </Link>
                      <PersonRowActions person={p} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: cada pessoa vira um card */}
        <MobileCards className="p-0">
          {filtered.length === 0 ? (
            <MobileEmpty>
              {people.length === 0
                ? "Nenhuma pessoa cadastrada ainda."
                : "Nenhuma pessoa encontrada com esse filtro."}
            </MobileEmpty>
          ) : (
            filtered.map((p) => (
              <MobileCard key={p.id}>
                <MobileCardHeader
                  title={
                    <Link href={`/pessoas/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  }
                  aside={<span className="font-semibold">{formatBRL(p.totalGasto)}</span>}
                />
                <div className="space-y-1.5">
                  <Field label="Tipo">
                    <Badge variant="secondary">{TYPE_LABEL[p.type] ?? p.type}</Badge>
                  </Field>
                  <Field label="Usuário vinculado">
                    {p.userEmail ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <UserCheck className="h-3.5 w-3.5" />
                        {p.userEmail}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Field>
                  <Field label="Devendo">
                    {p.aReceber > 0 ? (
                      <Badge variant="warning">{formatBRL(p.aReceber)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">{formatBRL(0)}</span>
                    )}
                  </Field>
                  <Field label="Já pago">
                    <span className="text-emerald-600">{formatBRL(p.pago)}</span>
                  </Field>
                </div>
                <MobileCardActions>
                  <Link href={`/pessoas/${p.id}`}>
                    <Button size="sm" variant="outline">
                      Ver detalhes <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </Link>
                  <PersonRowActions person={p} />
                </MobileCardActions>
              </MobileCard>
            ))
          )}
        </MobileCards>
      </CardContent>
    </Card>
  );
}
