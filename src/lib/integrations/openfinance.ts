import { prisma } from "@/lib/prisma";
import { receberNaCaixa, type EnvelopeGenerico, type ResultadoDaCaixa } from "@/lib/integrations/inbox";

/**
 * OPEN FINANCE (F5.3 · ref. 03 §4.2 entrada 9; roadmap Fase 5).
 *
 * Quem fala Open Finance de verdade é um AGREGADOR licenciado (contrato
 * comercial que a direção ainda não fechou) — este módulo é a nossa metade:
 * um webhook que recebe os movimentos bancários da conta conectada e os
 * entrega ao MESMO caminho da importação de extrato, com o MESMO hash de
 * deduplicação. Reconexão de banco reenvia a mesma janela de dias — é o caso
 * normal, e é por isso que o dedupe é do movimento, não do lote.
 *
 * Depois de gravar, a conciliação automática roda sozinha nas competências
 * afetadas. O que ela não resolver aparece na trilha de conciliação do Modo
 * Fila — o automático NUNCA decide o ambíguo.
 *
 * Configuração: OPENFINANCE_WEBHOOK_SECRET.
 */

export const FONTE_OPENFINANCE = "openfinance";

export const TIPOS_DO_OPENFINANCE = ["banking.transactions"] as const;

export function segredoDoOpenFinance(): string | null {
  const s = process.env.OPENFINANCE_WEBHOOK_SECRET;
  return s && s.length >= 16 ? s : null;
}

export async function receberEventoDoOpenFinance(
  corpo: string,
  assinatura: string | null
): Promise<ResultadoDaCaixa> {
  return receberNaCaixa({
    fonte: FONTE_OPENFINANCE,
    segredo: segredoDoOpenFinance(),
    erroDeConfiguracao: "Integração não configurada. Defina OPENFINANCE_WEBHOOK_SECRET.",
    corpo,
    assinatura,
    processar,
  });
}

async function processar(e: EnvelopeGenerico) {
  if (!(TIPOS_DO_OPENFINANCE as readonly string[]).includes(e.type)) {
    return {
      situacao: "IGNORADO" as const,
      nota: `Tipo “${e.type}” não é tratado pelo produto. O evento fica guardado.`,
    };
  }
  const d = (e.data ?? {}) as Record<string, any>;
  const accountId = String(d.accountId ?? "").trim();
  if (!accountId) return { situacao: "IGNORADO" as const, nota: "Evento sem a conta de destino." };

  const conta = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!conta)
    return { situacao: "IGNORADO" as const, nota: `A conta ${accountId} não existe aqui.` };

  const brutos: any[] = Array.isArray(d.transactions) ? d.transactions : [];
  const movimentos = brutos
    .map((t) => ({
      externalId: t?.id != null ? String(t.id) : null,
      postedAt: new Date(String(t?.postedAt ?? t?.date ?? "")),
      amount: Number(t?.amount),
      description: String(t?.description ?? "").trim() || "(sem descrição)",
      balanceAfter: t?.balanceAfter != null ? Number(t.balanceAfter) : null,
    }))
    // Linha ilegível NÃO vira movimento de R$ 0,00 — a regra da F3.5 vale
    // dobrada quando ninguém está olhando o arquivo.
    .filter((m) => Number.isFinite(m.amount) && m.amount !== 0 && !Number.isNaN(m.postedAt.getTime()));

  if (movimentos.length === 0)
    return { situacao: "IGNORADO" as const, nota: "Lote sem movimento legível." };

  const { registrarMovimentosDoBanco } = await import("@/lib/services/reconciliation");
  const r = await registrarMovimentosDoBanco(accountId, movimentos, FONTE_OPENFINANCE);
  if (!r.ok) return { situacao: "IGNORADO" as const, nota: r.error };

  return {
    situacao: "PROCESSADO" as const,
    nota:
      `${r.importadas} movimento(s) novo(s), ${r.duplicadas} repetido(s), ` +
      `${r.conciliadas} conciliado(s) automaticamente.`,
  };
}
