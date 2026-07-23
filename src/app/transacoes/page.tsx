import { redirect } from "next/navigation";

// Módulo "Movimentações" removido da interface (reorganização da plataforma).
// A rota fica oculta e redireciona para o Dashboard. Models Prisma (Transaction),
// server actions (lib/actions/transactions.ts) e a lógica compartilhada
// (importação de PDF, cartões, despesas) permanecem intactos.
export default function TransacoesPage() {
  redirect("/dashboard");
}
