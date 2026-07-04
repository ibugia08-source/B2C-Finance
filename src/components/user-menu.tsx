"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/auth";
import { LogOut } from "lucide-react";

export function UserMenu({
  user,
}: {
  user: { name: string; email: string; role: "ADMIN" | "USER" };
}) {
  const [pending, start] = useTransition();
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 px-3 py-3 border-t bg-card/40">
      <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
        {initials || "U"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.name}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {user.role === "ADMIN" ? "Administrador" : "Usuário"} · {user.email}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Sair"
        disabled={pending}
        onClick={() => start(() => logoutAction())}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
