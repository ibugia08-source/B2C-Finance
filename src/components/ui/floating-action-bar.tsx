"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Barra de ação flutuante, fixa ao rodapé do viewport.
 *
 * Renderiza via portal direto no <body> — de propósito. Um `position: fixed`
 * se ancora no viewport SÓ enquanto nenhum ancestral criar bloco de contenção;
 * qualquer `transform`, `filter`, `perspective`, `backdrop-filter`, `will-change`
 * ou `contain` num pai (ex.: a animação de entrada da página no <main>) faz o
 * `fixed` grudar naquele container em vez da tela, obrigando a rolar até o fim
 * para achar a barra. Saindo para o <body>, isso não pode mais acontecer.
 *
 * Passe o conteúdo já estilizado (o "cartão" interno) como children.
 */
export function FloatingActionBar({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-4 print:hidden pointer-events-none">
      {children}
    </div>,
    document.body
  );
}
