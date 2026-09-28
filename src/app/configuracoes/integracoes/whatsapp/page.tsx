import { redirect } from "next/navigation";

/** Endereço antigo (28/09/2026): os vínculos agora ficam em Integrações → Canais. */
export default function WhatsAppRedirect() {
  redirect("/configuracoes/integracoes/canais");
}
