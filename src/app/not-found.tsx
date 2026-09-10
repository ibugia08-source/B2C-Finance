import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandIllustration } from "@/components/brand";

export const metadata = { title: "Página não encontrada — B2C Finance" };

/**
 * 404 na família visual da identidade. Existia como tela padrão do
 * Next — texto preto em fundo branco, sem marca e em inglês — que era
 * o único ponto do produto onde o usuário saía do B2C Finance sem sair
 * do B2C Finance. A ilustração é decorativa; quem informa é o texto.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <BrandIllustration name="erro" width={240} className="mx-auto" />
        <h1 className="text-section font-semibold">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">
          O endereço que você abriu não existe ou foi movido. Volte para a
          visão geral e siga daí.
        </p>
        <Button asChild>
          <Link href="/dashboard">Voltar para a Visão geral</Link>
        </Button>
      </div>
    </div>
  );
}
