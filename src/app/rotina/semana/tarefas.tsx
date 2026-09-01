"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { setRoutineActionDone } from "@/lib/actions/routine";
import { formatBRL } from "@/lib/format";
import type { ItemDaSemana } from "@/lib/services/weekly-routine";

/**
 * As tarefas da semana (02 §4.6: "gera as tarefas da semana").
 *
 * Reaproveita o mesmo RoutineItemState da rotina diária de propósito: marcar
 * "conversei com este cliente" é o mesmo gesto, e duas tabelas de checklist
 * significariam dois lugares para procurar o que já foi feito.
 */
export function TarefasDaSemana({
  blocoId,
  itens,
}: {
  blocoId: string;
  itens: ItemDaSemana[];
}) {
  const [feitos, setFeitos] = useState<Set<string>>(new Set());
  const [, start] = useTransition();

  return (
    <ul className="mt-2.5 divide-y divide-border-soft border-t border-border-soft">
      {itens.map((i) => {
        const feito = feitos.has(i.chave);
        return (
          <li key={i.chave} className="flex items-center gap-2 py-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              id={`semana-${blocoId}-${i.chave}`}
              checked={feito}
              onChange={() => {
                const novo = !feito;
                setFeitos((s) => {
                  const c = new Set(s);
                  if (novo) c.add(i.chave);
                  else c.delete(i.chave);
                  return c;
                });
                start(async () => {
                  await setRoutineActionDone(`semana:${i.chave}`, novo);
                });
              }}
            />
            <label
              htmlFor={`semana-${blocoId}-${i.chave}`}
              className={`min-w-0 flex-1 cursor-pointer text-dense ${feito ? "text-muted-foreground line-through" : ""}`}
            >
              {i.titulo}
              {i.detalhe ? (
                <span className="ml-1.5 text-caption text-muted-foreground">{i.detalhe}</span>
              ) : null}
            </label>
            {i.valor !== null ? (
              <span className="whitespace-nowrap tabular-nums text-dense">
                {formatBRL(i.valor)}
              </span>
            ) : null}
            {i.href ? (
              <Link href={i.href} className="shrink-0 text-caption text-brand hover:underline">
                abrir
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
