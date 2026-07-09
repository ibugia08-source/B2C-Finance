import { redirect } from "next/navigation";

/**
 * Contas & Cartões deixou de ser módulo separado (briefing PARTE 8).
 * A configuração vive na aba "Cartões e Contas" dentro de Despesas.
 * O detalhe do cartão (/cartoes/[id]) permanece para consulta de histórico.
 */
export default function CartoesPage() {
  redirect("/despesas?aba=cartoes");
}
