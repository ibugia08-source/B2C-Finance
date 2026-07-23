"use client";
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleNavItems, type UserLike } from "./nav-items";
import { B2CLogo } from "./mascot";
import { ThemeToggle } from "./theme-toggle";
import { logoutAction } from "@/lib/actions/auth";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

/**
 * Gaveta "Mais" do mobile: dá acesso a TODAS as seções (inclusive as que não cabem
 * na barra inferior), além de perfil, troca de tema e logout — antes só disponíveis
 * na sidebar do desktop.
 */
export function MobileMenu({
  user,
  trigger,
}: {
  user: UserLike;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, start] = useTransition();
  const path = usePathname();
  const items = visibleNavItems(user);

  // Fecha a gaveta automaticamente ao trocar de rota.
  React.useEffect(() => {
    setOpen(false);
  }, [path]);

  const initials = (user?.name ?? "")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-[86%] max-w-sm flex-col border-l bg-background shadow-2xl duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Cabeçalho */}
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <B2CLogo height={24} />
              <div className="min-w-0">
                <Dialog.Title className="text-base font-bold leading-none tracking-tight">
                  B2C <span className="text-primary">Finance</span>
                </Dialog.Title>
                <Dialog.Description className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">
                  Menu
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-5 w-5" />
              <span className="sr-only">Fechar menu</span>
            </Dialog.Close>
          </div>

          {/* Navegação (rolável) */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
            {items.map((it) => {
              const Icon = it.icon;
              const active = path === it.href || path?.startsWith(it.href + "/");
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 min-h-[48px] text-[15px] font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-foreground/90 hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {it.label}
                </Link>
              );
            })}
          </nav>

          {/* Rodapé: tema + perfil + sair */}
          <div className="border-t">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Tema
              </span>
              <ThemeToggle />
            </div>
            {user && (
              <div className="flex items-center gap-3 border-t px-4 py-3 bg-card/40">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {initials || "U"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {ROLE_LABEL[user.role as Role] ?? "Usuário"} · {user.email}
                  </p>
                </div>
                <button
                  type="button"
                  title="Sair"
                  aria-label="Sair"
                  disabled={pending}
                  onClick={() => start(() => logoutAction())}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
