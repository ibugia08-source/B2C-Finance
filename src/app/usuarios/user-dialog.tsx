"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createUser, updateUser } from "@/lib/actions/users";
import { Plus } from "lucide-react";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  type Role,
} from "@/lib/permissions";
import {
  PermissionsMatrix,
  overridesFromRows,
  type OverrideMap,
} from "./permissions-matrix";

export function UserDialog({
  people,
  initial,
  trigger,
  canManagePermissions = true,
}: {
  people: any[];
  initial?: any;
  trigger?: React.ReactNode;
  /** Sem usuarios.alterar_permissoes → papel e matriz ficam travados. */
  canManagePermissions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const editing = !!initial?.id;
  const [role, setRole] = useState<Role>((initial?.role as Role) ?? "FINANCEIRO");
  const [overrides, setOverrides] = useState<OverrideMap>(() =>
    overridesFromRows(initial?.permissions)
  );
  const [pending, setPending] = useState(false);

  // Papel legado USER só aparece como opção para quem já o tem (compatibilidade).
  const roleOptions: Role[] =
    initial?.role === "USER" ? [...ASSIGNABLE_ROLES, "USER"] : ASSIGNABLE_ROLES;

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setRole((initial?.role as Role) ?? "FINANCEIRO");
      setOverrides(overridesFromRows(initial?.permissions));
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo usuário
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            setPending(true);
            try {
              const res = editing ? await updateUser(fd) : await createUser(fd);
              if (res && !res.ok) {
                alert(res.error);
                return;
              }
              setOpen(false);
            } finally {
              setPending(false);
            }
          }}
          className="space-y-4"
        >
          {editing && <input type="hidden" name="id" value={initial.id} />}
          {/* Diferenças de permissão vs. o padrão do papel (JSON). */}
          <input
            type="hidden"
            name="permissions"
            value={JSON.stringify(
              Object.entries(overrides).map(([permission, enabled]) => ({
                permission,
                enabled,
              }))
            )}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nome</Label>
              <Input name="name" defaultValue={initial?.name ?? ""} required />
            </div>
            <div className="col-span-2">
              <Label>E-mail</Label>
              <Input
                name="email"
                type="email"
                defaultValue={initial?.email ?? ""}
                required
              />
            </div>
            <div className="col-span-2">
              <Label>{editing ? "Nova senha (opcional)" : "Senha inicial"}</Label>
              <Input
                name="password"
                type="text"
                placeholder={editing ? "Deixe em branco para manter" : "mínimo 6 caracteres"}
                required={!editing}
                minLength={editing ? undefined : 6}
              />
            </div>
            <div>
              <Label>Papel / Função</Label>
              <Select
                name="role"
                value={role}
                disabled={!canManagePermissions}
                onChange={(e) => {
                  setRole(e.target.value as Role);
                  // Papel novo → recomeça do padrão dele (sem ajustes antigos).
                  setOverrides({});
                }}
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select name="active" defaultValue={String(initial?.active ?? true)}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Pessoa vinculada (opcional)</Label>
              <Select name="personId" defaultValue={initial?.personId ?? ""}>
                <option value="">— sem vínculo</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.userId && p.userId !== initial?.id ? " (já vinculada)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="border-t pt-3">
            <Label className="mb-2 block">O que este usuário pode fazer</Label>
            {canManagePermissions ? (
              <PermissionsMatrix role={role} overrides={overrides} onChange={setOverrides} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Você não tem permissão para alterar papel e permissões.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
