import Link from "next/link";

/** Abas de Configurações → Integrações. Links simples (a aba é a URL). */
export function IntegracoesTabs({ ativa }: { ativa: "chaves" | "whatsapp" | "atividades" }) {
  const abas = [
    { key: "chaves", href: "/configuracoes/integracoes", label: "Chaves de API" },
    { key: "whatsapp", href: "/configuracoes/integracoes/whatsapp", label: "WhatsApp" },
    { key: "atividades", href: "/configuracoes/integracoes/atividades", label: "Atividades da IA/API" },
  ] as const;
  return (
    <nav aria-label="Seções de integrações" className="mb-4 flex gap-1 overflow-x-auto border-b">
      {abas.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          aria-current={ativa === a.key ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            ativa === a.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
