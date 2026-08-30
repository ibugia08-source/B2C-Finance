"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Personalização do B2C Finance 2: tema (claro/sistema/escuro) e COR DE
 * DESTAQUE. A escolha vive no navegador (localStorage `b2c:accent`) e é
 * aplicada antes da pintura pelo script do layout — os presets de token
 * moram em globals.css (html[data-accent=...]).
 */
const ACCENTS: { key: string | null; label: string; swatch: string }[] = [
  { key: null, label: "Esmeralda", swatch: "hsl(172 68% 25%)" },
  { key: "safira", label: "Safira", swatch: "hsl(214 78% 42%)" },
  { key: "ametista", label: "Ametista", swatch: "hsl(268 52% 44%)" },
  { key: "ambar", label: "Âmbar", swatch: "hsl(30 88% 34%)" },
];

const STORAGE_KEY = "b2c:accent";

export function AppearanceCard() {
  const [accent, setAccent] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setAccent(localStorage.getItem(STORAGE_KEY));
    } catch {}
  }, []);

  function choose(key: string | null) {
    setAccent(key);
    try {
      if (key) localStorage.setItem(STORAGE_KEY, key);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    if (key) document.documentElement.setAttribute("data-accent", key);
    else document.documentElement.removeAttribute("data-accent");
  }

  return (
    <Card className="mb-3">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-medium">
              Aparência
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tema e cor de destaque — a escolha fica salva neste navegador.
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {ACCENTS.map((a) => {
            const selected = mounted && accent === a.key;
            return (
              <button
                key={a.label}
                type="button"
                onClick={() => choose(a.key)}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground"
                )}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ background: a.swatch }}
                >
                  {selected && <Check className="h-3 w-3 text-white" />}
                </span>
                {a.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
