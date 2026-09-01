"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { showUndoToast } from "@/components/undo-toast";
import { registrarAtividadeAction, sincronizarAtividade } from "@/lib/actions/atividade";
import {
  CAMPOS_DE_ATIVIDADE, type CampoDeAtividade,
} from "@/lib/commercial/atividade";
import type { PainelDoSdr } from "@/lib/services/sdr-activity";

type PainelSerializado = Omit<PainelDoSdr, "data"> & { data: string };

/**
 * O contador.
 *
 * TRÊS DECISÕES QUE FAZEM OS 30 SEGUNDOS EXISTIREM:
 *
 *  1. O toque soma NA TELA na hora e manda para o servidor depois (otimista,
 *     02 §7.7). Esperar a resposta para ver o número mudar transforma seis
 *     toques em seis esperas — e no 4G da rua isso é meio minuto sozinho.
 *  2. NÃO há botão de salvar. Cada toque já é o registro.
 *  3. O alvo do dia fica ao lado do número, sempre. Meta atrás de um clique
 *     é meta que ninguém vê.
 *
 * O "−" existe porque errar o toque é normal, e desfazer tem de custar o
 * mesmo que o erro.
 */
export function ContadorDeAtividade({
  painel,
  nomes,
  podeRegistrar,
}: {
  painel: PainelSerializado;
  nomes: string[];
  podeRegistrar: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(painel.hoje);
  const [mes, setMes] = useState(painel.mes);
  const [, start] = useTransition();

  useEffect(() => {
    setValores(painel.hoje);
    setMes(painel.mes);
  }, [painel.hoje, painel.mes]);

  // Ao sair da tela, os painéis que leem atividade são recarregados de uma
  // vez só — em vez de a cada toque.
  useEffect(() => {
    return () => {
      void sincronizarAtividade();
    };
  }, []);

  function tocar(campo: CampoDeAtividade, delta: number) {
    if (!podeRegistrar) return;
    setValores((v) => ({ ...v, [campo]: Math.max(0, v[campo] + delta) }));
    setMes((v) => ({ ...v, [campo]: Math.max(0, v[campo] + delta) }));
    start(async () => {
      const r = await registrarAtividadeAction(painel.sdr, campo, delta, painel.agencyId);
      if (!r.ok) {
        setValores(painel.hoje);
        setMes(painel.mes);
        showUndoToast({ message: r.error });
      }
    });
  }

  return (
    <>
      {nomes.length > 1 ? (
        <div className="mb-3">
          <label htmlFor="sdr" className="mb-1 block text-caption text-muted-foreground">
            Atividade de
          </label>
          <Select
            id="sdr"
            value={painel.sdr}
            onChange={(e) => router.push(`/atividade?sdr=${encodeURIComponent(e.target.value)}`)}
            className="h-11"
          >
            {nomes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {CAMPOS_DE_ATIVIDADE.map((c) => {
          const progresso = painel.progresso.find((p) => p.campo === c.id)!;
          return (
            <Card key={c.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{c.rotulo}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {progresso.metaDoDia !== null
                      ? `hoje ${valores[c.id]} de ${progresso.metaDoDia} · mês ${mes[c.id]}${progresso.metaDoMes ? ` de ${progresso.metaDoMes}` : ""}`
                      : `hoje ${valores[c.id]} · mês ${mes[c.id]}`}
                  </p>
                </div>

                <span
                  className={`stat-number w-12 shrink-0 text-center text-value font-semibold tabular-nums ${
                    progresso.metaDoDia !== null && valores[c.id] >= progresso.metaDoDia
                      ? "text-success"
                      : ""
                  }`}
                  aria-live="polite"
                >
                  {valores[c.id]}
                </span>

                {podeRegistrar ? (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      aria-label={`Tirar um de ${c.rotulo}`}
                      onClick={() => tocar(c.id, -1)}
                      className="flex h-11 w-11 items-center justify-center rounded-md border text-muted-foreground active:scale-95"
                    >
                      <Minus className="h-5 w-5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Somar um em ${c.rotulo}`}
                      onClick={() => tocar(c.id, 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground active:scale-95"
                    >
                      <Plus className="h-5 w-5" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-3">
        <CardContent className="p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-dense">Comparecimento no mês</span>
            <span className="tabular-nums font-medium">
              {painel.comparecimento === null
                ? "—"
                : `${painel.comparecimento}%`}
            </span>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            Reuniões realizadas ÷ (realizadas + no-shows). Sem reunião marcada
            no mês, não há o que calcular.
          </p>
        </CardContent>
      </Card>

      {painel.progresso.every((p) => p.metaDoMes === null) ? (
        <p className="mt-3 text-dense text-muted-foreground">
          Nenhuma meta definida para {painel.sdr} neste mês. Sem meta, os
          números aparecem sem alvo — e é melhor assim do que inventar um.
        </p>
      ) : null}
    </>
  );
}
