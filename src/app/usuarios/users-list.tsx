"use client";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserRowActions } from "./row-actions";
import { Search, ShieldCheck, UserCheck } from "lucide-react";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  personId: string | null;
  personName: string | null;
};

export function UsersList({ users, people }: { users: UserRow[]; people: any[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (role && u.role !== role) return false;
      if (status === "ativo" && !u.active) return false;
      if (status === "inativo" && u.active) return false;
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [users, query, role, status]);

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
                placeholder="Nome ou e-mail…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="w-full sm:w-44">
            <Label className="text-xs">Papel</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Todos</option>
              <option value="ADMIN">Administrador</option>
              <option value="USER">Usuário</option>
            </Select>
          </div>
          <div className="w-full sm:w-40">
            <Label className="text-xs">Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="ativo">Ativos</option>
              <option value="inativo">Inativos</option>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground sm:pb-2 whitespace-nowrap">
            {filtered.length} de {users.length}
          </div>
        </div>

        <div className="hidden md:block border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pessoa vinculada</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    <ShieldCheck className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    {users.length === 0
                      ? "Nenhum usuário cadastrado ainda."
                      : "Nenhum usuário encontrado com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>
                      {u.role === "ADMIN" ? "Administrador" : "Usuário"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? "success" : "outline"}>
                      {u.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.personName ? (
                      <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
                        <UserCheck className="h-3.5 w-3.5" />
                        {u.personName}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <UserRowActions user={u} people={people} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: cada usuário vira um card */}
        <MobileCards className="p-0">
          {filtered.length === 0 ? (
            <MobileEmpty>
              {users.length === 0
                ? "Nenhum usuário cadastrado ainda."
                : "Nenhum usuário encontrado com esse filtro."}
            </MobileEmpty>
          ) : (
            filtered.map((u) => (
              <MobileCard key={u.id}>
                <MobileCardHeader
                  title={u.name}
                  aside={
                    <Badge variant={u.active ? "success" : "outline"}>
                      {u.active ? "Ativo" : "Inativo"}
                    </Badge>
                  }
                />
                <div className="space-y-1.5">
                  <Field label="E-mail">{u.email}</Field>
                  <Field label="Papel">
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>
                      {u.role === "ADMIN" ? "Administrador" : "Usuário"}
                    </Badge>
                  </Field>
                  <Field label="Pessoa vinculada">
                    {u.personName ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <UserCheck className="h-3.5 w-3.5" />
                        {u.personName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Field>
                </div>
                <MobileCardActions>
                  <UserRowActions user={u} people={people} />
                </MobileCardActions>
              </MobileCard>
            ))
          )}
        </MobileCards>
      </CardContent>
    </Card>
  );
}
