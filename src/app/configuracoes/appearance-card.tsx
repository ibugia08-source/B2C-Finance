"use client";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Aparência: claro / sistema / escuro (02 §7.2 — "usuário escolhe").
 *
 * O seletor de COR DE DESTAQUE saiu no F1.13: a spec define um acento
 * único ("um acento por tela além da semântica", 02 §7.2) e o azul
 * institucional é parte da identidade, não preferência de usuário.
 * Deixar quatro acentos quebrava a paleta de dataviz (que começa pelo
 * acento e foi validada para daltonismo com ELE) e o contraste AA
 * calculado par a par. A personalização real fica no que é do usuário:
 * tema, colunas da carteira e período.
 */
export function AppearanceCard() {
  return (
    <Card className="mb-3">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-caption uppercase tracking-[0.14em] text-muted-foreground font-medium">
              Aparência
            </p>
            <p className="mt-1 text-body text-muted-foreground">
              Tema claro, escuro ou o do sistema — a escolha fica salva neste navegador.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}
