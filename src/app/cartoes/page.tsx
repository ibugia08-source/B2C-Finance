import { redirect } from "next/navigation";

/**
 * ROTA LEGADA. O cadastro manual de contas bancárias e cartões SAIU em
 * 02/09/2026 por decisão da direção — não é mais assim que conta existe no
 * sistema (a conta nasce da importação de extrato ou da conexão bancária).
 * O link antigo aponta para Despesas, onde o assunto vivia.
 */
export default function CartoesLegado() {
  redirect("/despesas");
}
