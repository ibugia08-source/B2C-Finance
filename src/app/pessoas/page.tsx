import { redirect } from "next/navigation";

// Módulo "Pessoas & reembolsos" removido da interface (reorganização da
// plataforma). A rota fica oculta e redireciona para o Dashboard. Models Prisma
// (Person, PersonPayment) e a lógica compartilhada (responsáveis de cartões/
// despesas, reembolsos) permanecem; as server actions do módulo foram
// removidas na limpeza de 2026-08-13 (zero consumidores).
// Clientes ficam no módulo Clientes; responsáveis, em Usuários.
export default function PessoasPage() {
  redirect("/dashboard");
}
