"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { PAGE_SIZES } from "./_meta";

/** Seletor de linhas por página (persistido na URL via ?porPagina=). */
export function PageSizeSelect({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Exibir
      <Select
        aria-label="Linhas por página"
        className="h-8 w-[76px] px-2 py-0 text-sm"
        value={String(value)}
        onChange={(e) => {
          const params = new URLSearchParams(sp.toString());
          params.set("porPagina", e.target.value);
          params.delete("pagina"); // volta à 1ª página ao trocar o tamanho
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
      linhas
    </label>
  );
}
