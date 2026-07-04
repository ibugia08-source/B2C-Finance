import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "B2C Finance — Inteligência financeira",
  description:
    "B2C Finance: inteligência financeira pessoal, familiar e empresarial — controle de receitas, caixa, contas, dívidas e metas com copiloto de IA.",
};

// Aplica o tema antes da pintura para evitar "flash" (FOUC).
// Padrão = escuro (identidade dark-first); 'light'/'system' respeitam a escolha.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)):true;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark');}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
