import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";

export const metadata = { title: "Acesso restrito — B2C Finance" };

/**
 * Tela amigável para quem tenta abrir uma área sem permissão.
 * Exige apenas sessão (nenhuma permissão) — nunca entra em loop de redirect.
 */
export default async function AcessoRestritoPage() {
  await getViewer("/acesso-restrito");

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mx-auto max-w-md text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <ShieldAlert className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para acessar esta área. Fale com um
          administrador se precisar de acesso.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard">Voltar para o Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
