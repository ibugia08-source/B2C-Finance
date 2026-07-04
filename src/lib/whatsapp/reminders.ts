import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { getWhatsAppSettings, isWhatsAppReady, sendText } from "./provider";

/** Monta o texto de lembretes (faturas + despesas a vencer/atrasadas). */
export async function buildReminders(daysAhead = 7): Promise<string | null> {
  const now = new Date();
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, 23, 59, 59);

  const [invoices, expenses] = await Promise.all([
    prisma.creditCardInvoice.findMany({
      where: { status: { in: ["aberta", "fechada", "parcial", "atrasada"] }, dueDate: { lte: limit } },
      orderBy: { dueDate: "asc" },
      include: { card: true },
    }),
    prisma.transaction.findMany({
      where: { type: "despesa", status: "pendente", dueDate: { not: null, lte: limit } },
      orderBy: { dueDate: "asc" },
      take: 30,
    }),
  ]);

  if (invoices.length === 0 && expenses.length === 0) return null;

  const lines: string[] = ["🔔 *Lembretes financeiros — B2C Finance*", ""];
  const isLate = (d: Date) => d < new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (invoices.length) {
    lines.push("*Faturas:*");
    for (const i of invoices) {
      const open = i.total - i.paid;
      const tag = isLate(i.dueDate) ? "⚠️ atrasada" : "a vencer";
      lines.push(`• ${i.card.name} — ${formatBRL(open)} (${tag} ${formatDateBR(i.dueDate)})`);
    }
    lines.push("");
  }

  if (expenses.length) {
    lines.push("*Despesas:*");
    for (const e of expenses) {
      const tag = e.dueDate && isLate(e.dueDate) ? "⚠️ atrasada" : "a vencer";
      lines.push(
        `• ${e.description} — ${formatBRL(e.amount)} (${tag}${e.dueDate ? " " + formatDateBR(e.dueDate) : ""})`
      );
    }
  }

  return lines.join("\n").trim();
}

export type RemindersResult = { ok: boolean; sent: boolean; message?: string; error?: string };

/** Monta e envia os lembretes ao número pessoal. */
export async function sendReminders(daysAhead = 7): Promise<RemindersResult> {
  const s = await getWhatsAppSettings();
  if (!isWhatsAppReady(s)) return { ok: false, sent: false, error: "WhatsApp não configurado/ativo." };

  const text = await buildReminders(daysAhead);
  if (!text) return { ok: true, sent: false, message: "Nada a lembrar no período." };

  const r = await sendText(s.myNumber!, text);
  if (!r.ok) return { ok: false, sent: false, error: r.error };

  await prisma.whatsAppMessage.create({
    data: { direction: "out", waType: "text", fromNumber: null, body: text, actionTaken: "reminders" },
  });
  return { ok: true, sent: true, message: text };
}
