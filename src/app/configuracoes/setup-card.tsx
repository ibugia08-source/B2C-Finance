"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { showUndoToast } from "@/components/undo-toast";
import { reabrirSetupAction } from "@/lib/actions/setup";

/**
 * Retomar a lista de primeiros passos (F1.20 · 02 §3).
 *
 * Existe porque o card da home tem "Esconder", e esconder sem caminho de
 * volta é uma porta que tranca por fora: a lista some para sempre e o dono
 * fica sem saber o que faltou configurar.
 */
export function SetupCard({
  encerrado,
  feitos,
  total,
}: {
  encerrado: boolean;
  feitos: number;
  total: number;
}) {
  const [pending, start] = useTransition();
  const [reaberto, setReaberto] = useState(false);
  const tudoFeito = feitos === total;

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
            {tudoFeito ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <ListChecks className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
          <div>
            <p className="text-body font-medium">Primeiros passos</p>
            <p className="text-dense text-muted-foreground">
              {feitos} de {total} prontos
              {tudoFeito
                ? " — o sistema está configurado."
                : encerrado && !reaberto
                  ? " — a lista está escondida da home."
                  : " — a lista aparece na home."}
            </p>
          </div>
        </div>
        {tudoFeito ? null : encerrado && !reaberto ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await reabrirSetupAction();
                setReaberto(true);
                showUndoToast({ message: "Lista de primeiros passos de volta na home." });
              })
            }
          >
            Mostrar de novo na home
          </Button>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Ver a lista</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
