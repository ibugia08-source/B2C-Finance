import { redirect } from "next/navigation";

// O módulo "Receber" foi removido. Os valores a receber agora são gerenciados
// por pessoa (em /pessoas e no detalhe de cada pessoa).
export default function ReceberPage() {
  redirect("/pessoas");
}
