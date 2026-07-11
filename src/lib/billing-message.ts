/**
 * Gerador de mensagens de cobrança (pt-BR) — puro, sem dependências de
 * servidor: usável tanto em Server Actions quanto em componentes client.
 */

export type MessageTone =
  | "padrao"
  | "amigavel"
  | "formal"
  | "direto"
  | "urgente"
  | "ultima_tentativa"
  | "reativacao";

export const TONE_LABEL: Record<MessageTone, string> = {
  padrao: "Padrão B2C (recomendada)",
  amigavel: "Leve / amigável",
  formal: "Profissional (formal)",
  direto: "Direto",
  urgente: "Urgente",
  ultima_tentativa: "Última tentativa",
  reativacao: "Reativação de inadimplente",
};

export type BillingMessageInput = {
  clientName: string;
  openAmount: string; // já formatado em BRL
  dueDate: string; // dd/mm/aaaa
  daysOverdue: number; // 0 = ainda não venceu
  serviceNames: string[];
  hasPromise: boolean; // já houve promessa de pagamento
  contactCount: number; // interações de cobrança anteriores
  /** mês de referência da cobrança (ex.: "Julho/2026") */
  referenceMonth?: string;
  /** forma de regularização (ex.: "PIX chave x@y.com"); omitido → frase genérica */
  paymentInfo?: string;
};

/** Acima deste atraso, a mensagem padrão passa ao tom "muito atrasado". */
const VERY_LATE_DAYS = 15;

export function buildBillingMessage(
  tone: MessageTone,
  i: BillingMessageInput
): string {
  const first = i.clientName.split(" ")[0];
  const servico = i.serviceNames.length
    ? i.serviceNames.join(", ")
    : "nossos serviços";
  const atraso =
    i.daysOverdue > 0
      ? `${i.daysOverdue} dia${i.daysOverdue === 1 ? "" : "s"} de atraso`
      : null;
  const regularizacao =
    i.paymentInfo ?? "PIX ou transferência — me confirme que envio os dados agora";

  const mesRef = i.referenceMonth ?? `o vencimento de ${i.dueDate}`;

  switch (tone) {
    // Templates oficiais do módulo Recebimentos: a vencer, atrasado e
    // muito atrasado — escolhidos automaticamente pelos dias de atraso.
    case "padrao":
      if (i.daysOverdue <= 0) {
        return [
          `Olá, ${first}! Tudo bem?`,
          ``,
          `Passando para lembrar que o pagamento referente a ${mesRef}, no valor de ${i.openAmount}, vence em ${i.dueDate}.`,
          ``,
          `Qualquer dúvida, fico à disposição.`,
        ].join("\n");
      }
      if (i.daysOverdue < VERY_LATE_DAYS) {
        return [
          `Olá, ${first}! Tudo bem?`,
          ``,
          `Identifiquei que o pagamento referente a ${mesRef}, no valor de ${i.openAmount}, venceu em ${i.dueDate} e ainda está pendente.`,
          ``,
          `Consegue me dar um retorno sobre a previsão de pagamento?`,
        ].join("\n");
      }
      return [
        `Olá, ${first}. Tudo bem?`,
        ``,
        `O pagamento referente a ${mesRef}, no valor de ${i.openAmount}, está com ${i.daysOverdue} dia${i.daysOverdue === 1 ? "" : "s"} de atraso.`,
        ``,
        `Preciso confirmar com você uma previsão para regularização.`,
      ].join("\n");

    case "amigavel":
      return [
        `Oi, ${first}! Tudo bem? 😊`,
        ``,
        atraso
          ? `Passando pra lembrar do valor de ${i.openAmount} referente a ${servico}, que venceu em ${i.dueDate} (${atraso}).`
          : `Passando pra lembrar do valor de ${i.openAmount} referente a ${servico}, com vencimento em ${i.dueDate}.`,
        ``,
        `Para regularizar: ${regularizacao}.`,
        ``,
        `Consegue verificar pra gente? Qualquer coisa me chama por aqui! 🙏`,
      ].join("\n");

    case "direto":
      return [
        `${first}, ${atraso ? `o pagamento de ${i.openAmount} (${servico}) venceu em ${i.dueDate} — ${atraso}.` : `o pagamento de ${i.openAmount} (${servico}) vence em ${i.dueDate}.`}`,
        ``,
        `Para regularizar: ${regularizacao}.`,
        ``,
        `Pode confirmar o pagamento ou me passar uma previsão?`,
      ].join("\n");

    case "formal":
      return [
        `Prezado(a) ${i.clientName},`,
        ``,
        atraso
          ? `Identificamos que o pagamento no valor de ${i.openAmount}, referente a ${servico}, com vencimento em ${i.dueDate}, encontra-se em aberto (${atraso}).`
          : `Lembramos que o pagamento no valor de ${i.openAmount}, referente a ${servico}, tem vencimento em ${i.dueDate}.`,
        ``,
        `Solicitamos a gentileza de regularizar a situação (${regularizacao}) ou nos informar a previsão de pagamento.`,
        ``,
        `Atenciosamente,`,
        `Equipe B2C Gestão`,
      ].join("\n");

    case "urgente":
      return [
        `${first}, precisamos resolver hoje. ⚠️`,
        ``,
        `O valor de ${i.openAmount} referente a ${servico} está em aberto desde ${i.dueDate}${atraso ? ` (${atraso})` : ""}.`,
        i.hasPromise
          ? `Tivemos uma previsão de pagamento que não se concretizou.`
          : i.contactCount > 1
            ? `Já tentamos contato ${i.contactCount} vezes sem retorno.`
            : ``,
        ``,
        `Para evitar a suspensão dos serviços, preciso da confirmação do pagamento ainda hoje (${regularizacao}). Pode me retornar?`,
      ]
        .filter(Boolean)
        .join("\n");

    case "ultima_tentativa":
      return [
        `${i.clientName}, esta é nossa última tentativa de contato amigável.`,
        ``,
        `O valor de ${i.openAmount} referente a ${servico} está em aberto desde ${i.dueDate}${atraso ? ` (${atraso})` : ""}.`,
        i.contactCount > 0
          ? `Já foram ${i.contactCount} tentativas de contato${i.hasPromise ? ", incluindo uma promessa de pagamento não cumprida" : ""}.`
          : ``,
        ``,
        `Sem retorno até amanhã, os serviços serão suspensos e a cobrança seguirá para as próximas medidas cabíveis.`,
        ``,
        `Para regularizar agora: ${regularizacao}.`,
        `Preferimos resolver de forma simples — me retorne ainda hoje.`,
      ]
        .filter(Boolean)
        .join("\n");

    case "reativacao":
      return [
        `Oi, ${first}! Aqui é da B2C Gestão. 👋`,
        ``,
        `Sentimos sua falta por aqui! Notamos que ficou um valor pendente de ${i.openAmount} referente a ${servico}${atraso ? ` (vencido há ${i.daysOverdue} dias)` : ""}.`,
        ``,
        `Queremos facilitar: podemos conversar sobre um parcelamento ou uma condição especial para regularizar e, quem sabe, retomar o trabalho juntos?`,
        ``,
        `Me diz um horário bom pra gente conversar. 🤝`,
      ].join("\n");
  }
}

/** Link wa.me com a mensagem pronta. */
export function whatsappLink(phone: string | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}
