import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectivePermissions } from "@/lib/permissions";
import { getScopeOptions } from "@/lib/services/org-scope";

// Fontes auto-hospedadas via next/font: sem @import bloqueante, sem FOUT.
// 02 §7.2 fixa duas famílias e só duas: Inter na interface e JetBrains Mono
// tabular em TODO número financeiro — dígitos de largura fixa é o que torna
// uma coluna de valores comparável a olho nu. `--font-display` continua
// existindo como alias da Inter para não quebrar os usos legados.
const bodyFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "B2C Finance — Gestão financeira da B2C Gestão",
  description:
    "B2C Finance: a plataforma financeira da B2C Gestão — clientes, contratos, cobranças, caixa, folha, relatórios e copiloto de IA.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

// Aplica o tema ANTES da pintura (sem flash). O seletor de acento saiu no
// F1.13 — acento único (02 §7.2) — e este script LIMPA o data-accent que
// tenha ficado gravado em navegadores da versão anterior.
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.removeAttribute('data-accent');localStorage.removeItem('b2c:accent');}catch(e){document.documentElement.classList.remove('dark');}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cu = await getCurrentUser();
  // Escopo organizacional da barra global — some sozinho quando há só
  // uma entidade e uma agência (ver services/org-scope.ts).
  const scopeOptions = await getScopeOptions();
  // Conjunto efetivo de permissões calculado no servidor → sidebar e menus
  // só exibem o que o usuário pode ver.
  const user = cu
    ? {
        name: cu.name,
        email: cu.email,
        role: cu.role,
        permissions: Array.from(effectivePermissions(cu)),
      }
    : null;
  // F1.19 — o sino do topo mostra quantas notificações esperam leitura.
  let naoLidas = 0;
  if (cu) {
    const { contarNaoLidas } = await import("@/lib/services/notifications");
    naoLidas = await contarNaoLidas(cu.id).catch(() => 0);
  }

  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${bodyFont.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AppShell user={user} scopeOptions={scopeOptions} naoLidas={naoLidas}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
