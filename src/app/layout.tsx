import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "B2C Finance — Gestão financeira da B2C Gestão",
  description:
    "B2C Finance: a plataforma financeira da B2C Gestão — clientes, contratos, cobranças, caixa, folha, relatórios e copiloto de IA.",
};

// Aplica o tema antes da pintura para evitar "flash" (FOUC).
// Padrão = claro (identidade B2C: azul sobre branco); 'dark'/'system' respeitam a escolha do usuário.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)):false;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.remove('dark');}})();`;

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
