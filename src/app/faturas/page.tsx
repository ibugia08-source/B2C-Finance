import { redirect } from "next/navigation";

// O módulo "Faturas" foi incorporado à aba "Histórico de faturas" em /importar.
export default function FaturasPage() {
  redirect("/importar");
}
