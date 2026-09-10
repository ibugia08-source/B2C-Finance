import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandIllustration } from "@/components/brand";
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
      <div className="mx-auto max-w-md space-y-4 text-center">
        <BrandIllustration name="acesso-negado" width={240} className="mx-auto" />
        <h1 className="text-section font-semibold">Acesso restrito</h1>
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
