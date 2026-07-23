import { redirect } from "next/navigation";

// Módulo "Pessoas & reembolsos" removido da interface (reorganização da
// plataforma). A rota fica oculta e redireciona para o Dashboard. Models Prisma
// (Person, PersonPayment), server actions (lib/actions/people.ts) e a lógica
// compartilhada (responsáveis de cartões/despesas, reembolsos) permanecem
// intactos. Clientes ficam no módulo Clientes; responsáveis, em Usuários.
export default function PessoasPage() {
  redirect("/dashboard");
}
