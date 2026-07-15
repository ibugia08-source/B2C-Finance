export function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm border-b border-border/50 pb-2 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground max-w-md">{children}</p>
    </div>
  );
}
