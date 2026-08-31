"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O botão some na impressão (`doc-so-tela`) — um botão "Imprimir" impresso
 * dentro do PDF é a marca registrada de página que ninguém testou imprimindo.
 */
export function BotaoImprimir() {
  return (
    <div className="doc-so-tela">
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="mr-1.5 h-3.5 w-3.5" />
        Salvar em PDF
      </Button>
      <p className="doc-dica">
        Na janela de impressão, escolha “Salvar como PDF”. Mantenha
        “Gráficos de plano de fundo” ligado para a capa sair com a cor certa.
      </p>
    </div>
  );
}
