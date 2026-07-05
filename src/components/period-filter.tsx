"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESETS: { key: string; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "trimestre", label: "Trimestre" },
  { key: "ano", label: "Ano" },
];

/** Filtro de período padrão do ERP (presets + de/até). */
export function PeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get("periodo") ?? (sp.get("de") || sp.get("ate") ? "custom" : "mes");

  function setPreset(key: string) {
    const params = new URLSearchParams(sp.toString());
    params.delete("de");
    params.delete("ate");
    if (key === "mes") params.delete("periodo");
    else params.set("periodo", key);
    router.push(`${pathname}?${params.toString()}`);
  }

  function setCustom(name: "de" | "ate", value: string) {
    const params = new URLSearchParams(sp.toString());
    params.delete("periodo");
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => setPreset(p.key)}>
            <Badge variant={current === p.key ? "default" : "outline"}>{p.label}</Badge>
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div>
          <Label className="text-xs">De</Label>
          <Input
            type="date"
            className="h-8"
            defaultValue={sp.get("de") ?? ""}
            onChange={(e) => setCustom("de", e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input
            type="date"
            className="h-8"
            defaultValue={sp.get("ate") ?? ""}
            onChange={(e) => setCustom("ate", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
