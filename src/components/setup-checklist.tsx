"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChevronRight, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  adiarPassoAction, encerrarSetupAction, retomarPassoAction,
} from "@/lib/actions/setup";
import { PASSO_FINAL, passoPorId } from "@/lib/setup-meta";
import type { EstadoSetup } from "@/lib/services/setup";

/**
 * CHECKLIST DE PRIMEIRO USO (F1.20 · ref. 02 §3).
 *
 * Três coisas que a spec exige e que a tela cumpre à risca:
 *   · NADA BLOQUEIA — cada passo tem "fazer depois", e o dono pode abrir o
 *     sistema inteiro sem tocar em nenhum;
 *   · o TEMPO é declarado, passo a passo e no total restante, porque
 *     "configure o sistema" sem número é o que faz a pessoa fechar a aba;
 *   · o passo 6 não é uma tarefa, é a CHEGADA: a Gestão do Mês populada.
 *
 * O que está feito vem do banco (existe agência? existe cliente?), nunca de
 * um clique — ver services/setup.ts.
 */
export function SetupChecklist({ estado }: { estado: EstadoSetup }) {
  const [pending, start] = useTransition();
  const [fechado, setFechado] = useState(false);
  if (fechado) return null;

  const pct = Math.round((estado.feitos / estado.total) * 100);
  const proximo = estado.passos.find((p) => !p.feito && !p.adiado);

  return (
    <Card className="mb-4 border-brand/25 bg-brand-subtle/40">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-emphasis font-semibold">Deixe o sistema pronto para usar</h2>
            <p className="mt-0.5 text-dense text-muted-foreground">
              {estado.feitos} de {estado.total} prontos
              {estado.minutosRestantes > 0 ? (
                <>
                  {" · "}
                  <Clock className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                  cerca de {estado.minutosRestantes} min do que falta
                </>
              ) : null}
              . Nada aqui trava o sistema — você pode deixar qualquer passo para depois.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={async () => {
              const ok = await confirmAction({
                title: "Esconder esta lista?",
                description:
                  "Ela some da home. Os passos que faltam continuam faltando, e você reabre a lista em Configurações.",
                confirmLabel: "Esconder",
              });
              if (!ok) return;
              setFechado(true);
              start(async () => {
                await encerrarSetupAction();
                showUndoToast({ message: "Lista de primeiros passos escondida." });
              });
            }}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Esconder
          </Button>
        </div>

        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Configuração inicial: ${pct}% concluída`}
        >
          <div className="h-full rounded-pill bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>

        <ol className="mt-3 divide-y divide-border-soft">
          {estado.passos.map((p) => {
            // O ícone é resolvido AQUI, no cliente, e não vem do servidor:
            // componente React é função, e função não atravessa a fronteira.
            const Icone = passoPorId(p.id).icon;
            const destaque = proximo?.id === p.id;
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 py-2.5"
                aria-current={destaque ? "step" : undefined}
              >
                <span
                  className={
                    p.feito
                      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
                      : p.adiado
                        ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-text-faint"
                        : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground"
                  }
                  aria-hidden
                >
                  {p.feito ? <Check className="h-4 w-4" /> : <Icone className="h-3.5 w-3.5" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium">
                    <span className="text-muted-foreground">{p.numero}. </span>
                    {p.titulo}
                    {p.feito ? (
                      <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                        {p.quantidade} {p.quantidade === 1 ? "cadastrado" : "cadastrados"}
                      </span>
                    ) : p.adiado ? (
                      <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                        deixado para depois
                      </span>
                    ) : (
                      <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                        ~{p.minutos} min
                      </span>
                    )}
                  </p>
                  {!p.feito && destaque ? (
                    <p className="mt-0.5 text-dense text-muted-foreground">{p.descricao}</p>
                  ) : null}
                </div>

                {p.feito ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    {p.adiado ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => start(() => retomarPassoAction(p.id).then(() => undefined))}
                      >
                        Retomar
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            await adiarPassoAction(p.id);
                            showUndoToast({
                              message: `"${p.titulo}" fica para depois.`,
                              onUndo: () => retomarPassoAction(p.id).then(() => undefined),
                            });
                          })
                        }
                      >
                        Depois
                      </Button>
                    )}
                    <Button asChild size="sm" variant={destaque ? "default" : "outline"}>
                      <Link href={p.href}>
                        {p.cta}
                        <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {estado.completo ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-raised px-3 py-2.5">
            <p className="text-dense">
              <strong>{PASSO_FINAL.titulo}.</strong> {PASSO_FINAL.descricao}
            </p>
            <Button asChild size="sm">
              <Link href={PASSO_FINAL.href}>{PASSO_FINAL.cta}</Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
