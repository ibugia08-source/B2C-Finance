import { redirect } from "next/navigation";

// "Pagamentos" (extrato global de recebimentos) saiu da navegação na
// reorganização no modelo da planilha: o extrato por cliente vive em
// /clientes/[id]?tab=pagamentos e o ciclo do mês na Gestão do Mês.
export default function PagamentosPage() {
  redirect("/cobrancas");
}
