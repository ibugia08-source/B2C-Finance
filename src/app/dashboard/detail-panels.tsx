import Link from "next/link";
import { formatBRL, formatDateBR } from "@/lib/format";
import type {
  ClientOpenItem, ReceivedItem, ExpenseItem, ExpenseCategorySlice, NamedValue,
} from "@/lib/services/dashboard-main";

/** Lista resumida de clientes (MRR/TCV/novos/renovações) — detalhe de card. */
export function NamedValueList({
  items, total, totalLabel, valueSuffix, emptyText,
}: {
  items: NamedValue[];
  total?: number;
  totalLabel?: string;
  valueSuffix?: string;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">{emptyText ?? "Sem itens no período."}</p>;
  }
  return (
    <div>
      <ul className="space-y-1 max-h-72 overflow-y-auto">
        {items.slice(0, 50).map((it, i) => {
          const row = (
            <>
              <span className="truncate">
                {it.name}
                {it.sub && <span className="text-[10px] text-muted-foreground ml-1.5">{it.sub}</span>}
              </span>
              <span className="tabular-nums whitespace-nowrap">
                {formatBRL(it.value)}{valueSuffix ?? ""}
              </span>
            </>
          );
          return (
            <li key={it.id ?? i} className="flex items-center justify-between gap-3 text-sm">
              {it.id ? (
                <Link href={`/clientes/${it.id}`} className="flex items-center justify-between gap-3 w-full hover:underline">
                  {row}
                </Link>
              ) : row}
            </li>
          );
        })}
      </ul>
      {total != null && (
        <div className="flex items-center justify-between gap-3 border-t mt-2 pt-2 text-sm font-semibold">
          <span>{totalLabel ?? "Total"}</span>
          <span className="tabular-nums">{formatBRL(total)}{valueSuffix ?? ""}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Painéis de DETALHE dos cards principais (abrem em modal na própria Dashboard).
 * Server components: recebem dados já calculados na camada central e apenas
 * apresentam. Respeitam o período filtrado (os dados vêm do page.tsx).
 */

const REVENUE_LABEL: Record<string, string> = {
  MRR: "MRR", TCV: "TCV", SETUP: "Setup", ONE_TIME: "Avulsa", RECOVERY: "Recuperação", OTHER: "Outra",
};

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-success" : tone === "neg" ? "text-destructive" : "";
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${strong ? "border-t mt-1 pt-2" : ""}`}>
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""} ${color}`}>{value}</span>
    </div>
  );
}

export function FaturamentoDetail({
  mrr, tcv, extra, total, mrrClients, tcvClients,
}: { mrr: number; tcv: number; extra: number; total: number; mrrClients: number; tcvClients: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Composição do faturamento previsto do mês</p>
      <Line label={`MRR — ${mrrClients} cliente(s) ativo(s)`} value={formatBRL(mrr)} />
      <Line label={`TCV — ${tcvClients} fechamento(s)/renovação(ões)`} value={formatBRL(tcv)} />
      <Line label="Receita Extra manual" value={formatBRL(extra)} />
      <Line label="Faturamento total" value={formatBRL(total)} strong />
      <p className="text-[11px] text-muted-foreground mt-3">
        TCV entra pelo valor cheio no mês da adesão/renovação (nunca rateado).
      </p>
    </div>
  );
}

export function DespesasDetail({
  categories, items, total,
}: { categories: ExpenseCategorySlice[]; items: ExpenseItem[]; total: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Despesas por categoria</p>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nenhuma despesa no período.</p>
      ) : (
        <div className="mb-3">
          {categories.slice(0, 8).map((c) => (
            <Line key={c.label} label={c.label} value={formatBRL(c.value)} />
          ))}
          <Line label="Total de despesas" value={formatBRL(total)} strong />
        </div>
      )}
      {items.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground mb-1 mt-4">Maiores despesas</p>
          <ul className="space-y-1">
            {items.slice(0, 6).map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{it.description}</span>
                <span className="tabular-nums whitespace-nowrap">{formatBRL(it.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/despesas" className="text-xs text-primary hover:underline mt-3 inline-block">
        Abrir módulo de Despesas →
      </Link>
    </div>
  );
}

export function RecebidoDetail({
  items, mrrReceived, tcvReceived, total,
}: { items: ReceivedItem[]; mrrReceived: number; tcvReceived: number; total: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Recebido por modalidade</p>
      <Line label="MRR recebido" value={formatBRL(mrrReceived)} />
      <Line label="TCV recebido" value={formatBRL(tcvReceived)} />
      <Line label="Total recebido" value={formatBRL(total)} strong tone="pos" />
      <p className="text-xs text-muted-foreground mb-1 mt-4">Recebimentos confirmados</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nenhum recebimento no período.</p>
      ) : (
        <ul className="space-y-1 max-h-52 overflow-y-auto">
          {items.slice(0, 30).map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">
                {it.clientName}
                <span className="text-[10px] text-muted-foreground ml-1.5">
                  {REVENUE_LABEL[it.revenueType ?? ""] ?? ""} · {formatDateBR(it.paidAt)}
                </span>
              </span>
              <span className="tabular-nums whitespace-nowrap text-success">{formatBRL(it.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmAbertoDetail({
  clients, emAberto, vencido,
}: { clients: ClientOpenItem[]; emAberto: number; vencido: number }) {
  return (
    <div>
      <Line label="Em aberto (total)" value={formatBRL(emAberto)} />
      <Line label="Vencido" value={formatBRL(vencido)} tone="neg" />
      <Line label="A vencer" value={formatBRL(Math.max(0, emAberto - vencido))} />
      <p className="text-xs text-muted-foreground mb-1 mt-4">Clientes com valor em aberto</p>
      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nada em aberto no período. 🎉</p>
      ) : (
        <ul className="space-y-1 max-h-60 overflow-y-auto">
          {clients.slice(0, 30).map((c) => (
            <li key={c.clientId} className="flex items-center justify-between gap-3 text-sm">
              <Link href={`/clientes/${c.clientId}?tab=cobrancas`} className="truncate hover:underline">
                {c.clientName}
                <span className="text-[10px] text-muted-foreground ml-1.5">
                  {c.overdue ? "vencido" : "a vencer"}
                  {c.dueDate ? ` · ${formatDateBR(c.dueDate)}` : ""}
                  {c.salesOwner ? ` · ${c.salesOwner}` : ""}
                </span>
              </Link>
              <span className={`tabular-nums whitespace-nowrap ${c.overdue ? "text-destructive" : ""}`}>
                {formatBRL(c.open)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResultadoDetail({
  recebido, despesas, resultado, margem, disponivel,
}: { recebido: number; despesas: number; resultado: number; margem: number; disponivel: number }) {
  return (
    <div>
      <Line label="Faturamento recebido" value={formatBRL(recebido)} tone="pos" />
      <Line label="Total de despesas" value={`− ${formatBRL(despesas)}`} tone="neg" />
      <Line label="Resultado do mês" value={formatBRL(resultado)} strong tone={resultado >= 0 ? "pos" : "neg"} />
      <Line label="Margem operacional" value={`${Math.round(margem * 100)}%`} />
      {resultado > 0 && (
        <p className="text-[11px] text-muted-foreground mt-3">
          Disponível para lançar ao caixa: <strong className="text-foreground">{formatBRL(disponivel)}</strong>.
        </p>
      )}
    </div>
  );
}
