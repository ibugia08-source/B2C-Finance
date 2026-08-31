"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { ScopeOptions } from "@/lib/services/org-scope";

/**
 * Seletor de escopo da barra global: Todas | EntidadeLegal | Agência
 * (02 §2). Escreve ?escopo=tipo:id na URL, preservando os demais
 * filtros — mesmo contrato do ?mes=.
 *
 * Enquanto houver só uma entidade e uma agência, o componente não
 * renderiza nada (ver a nota em services/org-scope.ts).
 */
export const ESCOPO_PARAM = "escopo";

export function ScopeSelector({ options }: { options: ScopeOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  if (!options.multiple) return null;

  const atual = sp.get(ESCOPO_PARAM) ?? "";

  function escolher(valor: string) {
    const params = new URLSearchParams(sp.toString());
    if (valor) params.set(ESCOPO_PARAM, valor);
    else params.delete(ESCOPO_PARAM);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="relative inline-flex h-9 items-center gap-1.5 rounded-input border bg-background pl-2.5 pr-1">
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        aria-label="Escopo"
        value={atual}
        onChange={(e) => escolher(e.target.value)}
        className="h-7 w-[150px] rounded-cell border-0 bg-transparent px-1 text-body font-medium focus-visible:ring-1 focus-visible:ring-offset-0"
      >
        <option value="">Todas</option>
        {options.entities.length > 1 && (
          <optgroup label="Entidade legal">
            {options.entities.map((e) => (
              <option key={e.id} value={`entidade:${e.id}`}>{e.label}</option>
            ))}
          </optgroup>
        )}
        {options.agencies.length > 1 && (
          <optgroup label="Agência">
            {options.agencies.map((a) => (
              <option key={a.id} value={`agencia:${a.id}`}>{a.label}</option>
            ))}
          </optgroup>
        )}
      </Select>
      <ChevronDown className="pointer-events-none h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </div>
  );
}
