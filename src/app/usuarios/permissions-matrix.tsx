"use client";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RotateCcw } from "lucide-react";
import {
  PERMISSION_MODULES,
  ROLE_PERMISSIONS,
  ROLE_DESCRIPTION,
  ALL_PERMISSION_IDS,
  type Role,
} from "@/lib/permissions";

/**
 * Matriz de permissões por módulo, usada no dialog de usuário.
 *
 * `overrides` guarda SÓ as diferenças vs. o padrão do papel:
 *   { "clientes.excluir": true } → concede além do papel;
 *   { "despesas.editar": false } → revoga algo do papel.
 * Marcar/desmarcar de volta ao padrão remove a diferença — assim "Restaurar
 * padrão do papel" é simplesmente zerar o mapa.
 */
export type OverrideMap = Record<string, boolean>;

export function overridesFromRows(
  rows: { permission: string; enabled: boolean }[] | null | undefined
): OverrideMap {
  const map: OverrideMap = {};
  for (const r of rows ?? []) map[r.permission] = r.enabled;
  return map;
}

export function PermissionsMatrix({
  role,
  overrides,
  onChange,
}: {
  role: Role;
  overrides: OverrideMap;
  onChange: (next: OverrideMap) => void;
}) {
  const roleDefaults = useMemo(() => {
    const list = ROLE_PERMISSIONS[role] ?? [];
    return new Set(list.includes("*") ? ALL_PERMISSION_IDS : list);
  }, [role]);

  const customized = Object.keys(overrides).length;

  if (role === "ADMIN") {
    return (
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Administrador tem acesso total a todos os módulos — não é preciso
        configurar permissões.
      </p>
    );
  }

  function toggle(id: string) {
    const effective = overrides[id] ?? roleDefaults.has(id);
    const next = !effective;
    const map = { ...overrides };
    // Igual ao padrão do papel → não é diferença, remove do mapa.
    if (next === roleDefaults.has(id)) delete map[id];
    else map[id] = next;
    onChange(map);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {ROLE_DESCRIPTION[role]} Ajuste abaixo o que este usuário pode fazer —
          as diferenças em relação ao papel ficam salvas só para ele.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={customized === 0}
          onClick={() => onChange({})}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Restaurar padrão do papel
        </Button>
      </div>

      <div className="max-h-[45vh] space-y-4 overflow-y-auto rounded-lg border p-3 pr-2">
        {PERMISSION_MODULES.map((mod) => (
          <fieldset key={mod.key}>
            <legend className="mb-1.5 text-sm font-medium">{mod.label}</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {mod.permissions.map((p) => {
                const effective = overrides[p.id] ?? roleDefaults.has(p.id);
                const changed = p.id in overrides;
                return (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50"
                  >
                    <Checkbox checked={effective} onChange={() => toggle(p.id)} />
                    <span className={changed ? "font-medium" : undefined}>{p.label}</span>
                    {p.sensitive && (
                      <Badge variant="outline" className="ml-auto shrink-0 text-[10px] px-1.5 py-0">
                        Sensível
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {customized > 0 && (
        <p className="text-xs text-muted-foreground">
          {customized} {customized === 1 ? "permissão ajustada" : "permissões ajustadas"} em
          relação ao padrão do papel.
        </p>
      )}
    </div>
  );
}
