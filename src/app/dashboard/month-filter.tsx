"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function DashboardMonthFilter({ current }: { current: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();

  function update(value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set("mes", value);
    else params.delete("mes");
    const qs = params.toString();
    router.push(qs ? `${path}?${qs}` : path);
  }

  return (
    <div className="flex items-end gap-2 rounded-xl border bg-card px-3 py-2">
      <div>
        <Label className="text-xs text-muted-foreground">Mês de análise</Label>
        <Input
          type="month"
          value={current}
          onChange={(e) => update(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button variant="outline" type="button" onClick={() => update("")}>
        Mês atual
      </Button>
    </div>
  );
}
