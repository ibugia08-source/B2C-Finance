import { redirect } from "next/navigation";

/** Rota canônica do briefing — o módulo vive em /cobrancas (renomeado). */
export default function RecebimentosPage() {
  redirect("/cobrancas");
}
