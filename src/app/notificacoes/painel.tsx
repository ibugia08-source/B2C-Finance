"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { BellOff, CheckCheck } from "lucide-react";
import { marcarLidaAction, marcarTodasLidasAction } from "@/lib/actions/notificacoes";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  event: string;
  title: string;
  detail: string | null;
  link: string | null;
  severity: string;
  count: number;
  digest: boolean;
  lida: boolean;
  quando: string;
};

export function PainelDeNotificacoes({ itens, naoLidas }: { itens: Item[]; naoLidas: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [verResumo, setVerResumo] = useState(false);

  const principais = useMemo(() => itens.filter((i) => !i.digest), [itens]);
  const resumo = useMemo(() => itens.filter((i) => i.digest), [itens]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-dense text-muted-foreground">
          {naoLidas > 0
            ? `${naoLidas} não ${naoLidas === 1 ? "lida" : "lidas"}.`
            : "Tudo lido."}
          {resumo.length > 0
            ? ` ${resumo.length} aviso(s) do dia foram para o resumo — o teto diário evita o sino virar ruído.`
            : ""}
        </p>
        <div className="flex gap-2">
          {resumo.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setVerResumo((v) => !v)}>
              {verResumo ? "Ocultar resumo" : `Ver resumo (${resumo.length})`}
            </Button>
          ) : null}
          {naoLidas > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await marcarTodasLidasAction();
                  router.refresh();
                })
              }
            >
              <CheckCheck className="mr-1.5 h-4 w-4" aria-hidden />
              Marcar todas como lidas
            </Button>
          ) : null}
        </div>
      </div>

      {principais.length === 0 && resumo.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Nada por aqui"
          description="Quando algo pedir sua atenção — cobrança vencida, contrato a renovar, avaliação pendente — aparece nesta lista, uma linha por assunto por dia."
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border-soft p-0">
            {[...principais, ...(verResumo ? resumo : [])].map((i) => (
              <div
                key={i.id}
                className={`flex flex-wrap items-start gap-3 px-4 py-3 ${i.lida ? "opacity-70" : ""}`}
              >
                <Badge
                  variant={
                    i.severity === "critica"
                      ? "destructive"
                      : i.severity === "alta"
                        ? "warning"
                        : "secondary"
                  }
                >
                  {i.severity === "critica" ? "Crítica" : i.severity === "alta" ? "Alta" : "Aviso"}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium">
                    {i.title}
                    {i.count > 1 ? (
                      <span className="ml-1.5 text-caption text-muted-foreground">×{i.count}</span>
                    ) : null}
                    {i.digest ? (
                      <Badge variant="outline" className="ml-1.5">resumo</Badge>
                    ) : null}
                  </p>
                  {i.detail ? (
                    <p className="text-dense text-muted-foreground">{i.detail}</p>
                  ) : null}
                  <p className="text-caption text-muted-foreground">
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(i.quando))}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {i.link ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={i.link}>Abrir</Link>
                    </Button>
                  ) : null}
                  {!i.lida ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await marcarLidaAction(i.id);
                          router.refresh();
                        })
                      }
                    >
                      Marcar lida
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
