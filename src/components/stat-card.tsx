import { Card, CardContent } from "@/lib/ui";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  hint,
  intent = "default",
}: {
  title: string;
  value: string;
  hint?: string;
  intent?: "default" | "positive" | "negative" | "warning";
}) {
  const color =
    intent === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : intent === "negative"
        ? "text-red-600 dark:text-red-400"
        : intent === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";

  const accent =
    intent === "positive"
      ? "from-emerald-500/10 to-transparent"
      : intent === "negative"
        ? "from-red-500/10 to-transparent"
        : intent === "warning"
          ? "from-amber-500/10 to-transparent"
          : "from-primary/10 to-transparent";

  return (
    <Card className="relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60",
          accent
        )}
      />
      <CardContent className="relative p-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
          {title}
        </p>
        <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 stat-number break-words", color)}>
          {value}
        </p>
        {hint && (
          <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
