"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
// Fonte única do tema (F1.14): a paleta de comandos alterna o tema pelo
// mesmo módulo, então não existem duas implementações para divergirem.
import { applyTheme, getTheme, setTheme as persistTheme, type Theme } from "@/lib/theme";

const OPTIONS: { key: Theme; icon: typeof Sun; label: string }[] = [
  { key: "light", icon: Sun, label: "Claro" },
  { key: "system", icon: Monitor, label: "Sistema" },
  { key: "dark", icon: Moon, label: "Escuro" },
];

export function ThemeToggle({
  className,
  orientation = "horizontal",
}: {
  className?: string;
  /** "vertical" empilha os 3 botões — usado na sidebar recolhida (80px). */
  orientation?: "horizontal" | "vertical";
}) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = getTheme();
    setTheme(stored);
    // Reage a mudanças do sistema quando no modo "Sistema"
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function choose(t: Theme) {
    setTheme(t);
    persistTheme(t);
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border bg-card/60 p-0.5",
        orientation === "vertical" && "flex-col",
        className
      )}
      role="group"
      aria-label="Tema"
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = mounted && theme === o.key;
        return (
          <button
            key={o.key}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            onClick={() => choose(o.key)}
            className={cn(
              "h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
