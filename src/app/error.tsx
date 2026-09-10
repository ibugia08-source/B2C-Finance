"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { BrandIllustration } from "@/components/brand";

/**
 * Fronteira de erro das rotas, na família visual da identidade.
 *
 * O `digest` é o único identificador que o servidor deixa chegar ao
 * navegador — a mensagem real fica no log do servidor de propósito, para
 * uma falha de consulta não vazar estrutura de dados financeiros na
 * tela. Mostrar o digest é o que torna o chamado de suporte rastreável.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <BrandIllustration name="erro" width={240} className="mx-auto" />
        <h1 className="text-section font-semibold">Algo deu errado aqui</h1>
        <p className="text-sm text-muted-foreground">
          Não conseguimos carregar esta tela. Tente de novo — se continuar,
          fale com o suporte informando o código abaixo.
        </p>
        {error.digest && (
          <p className="stat-number text-caption text-muted-foreground">
            Código: {error.digest}
          </p>
        )}
        <Button onClick={() => reset()}>Tentar de novo</Button>
      </div>
    </div>
  );
}
