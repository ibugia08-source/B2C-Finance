import { redirect } from "next/navigation";

// Detalhe de "Pessoas" removido da interface (reorganização da plataforma).
// A rota fica oculta e redireciona para o Dashboard. Models Prisma permanecem;
// as server actions do módulo foram removidas na limpeza de 2026-08-13.
export default function PessoaDetailPage() {
  redirect("/dashboard");
}
