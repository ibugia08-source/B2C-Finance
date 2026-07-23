import { redirect } from "next/navigation";

// Detalhe de "Pessoas" removido da interface (reorganização da plataforma).
// A rota fica oculta e redireciona para o Dashboard. Models e server actions
// (lib/actions/people.ts) permanecem intactos.
export default function PessoaDetailPage() {
  redirect("/dashboard");
}
