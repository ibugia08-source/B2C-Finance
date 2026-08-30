import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectivePermissions } from "@/lib/permissions";

// Fontes auto-hospedadas via next/font: sem @import bloqueante, sem FOUT.
// Identidade nova (30/08): Bricolage Grotesque para títulos (personalidade),
// Instrument Sans para o corpo (limpa e humanista em tamanhos de UI) e
// IBM Plex Mono para valores financeiros (dígitos tabulares comparáveis).
const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const bodyFont = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
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

// Aplica tema + cor de destaque ANTES da pintura (sem flash). Padrão =
// claro com destaque Esmeralda; 'dark'/'system' e o accent respeitam a
// escolha salva em Configurações → Aparência.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)):false;document.documentElement.classList.toggle('dark',d);var a=localStorage.getItem('b2c:accent');if(a&&['safira','ametista','ambar'].indexOf(a)>=0){document.documentElement.setAttribute('data-accent',a);}else{document.documentElement.removeAttribute('data-accent');}}catch(e){document.documentElement.classList.remove('dark');}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cu = await getCurrentUser();
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
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${displayFont.variable} ${bodyFont.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
