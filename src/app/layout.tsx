import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectivePermissions } from "@/lib/permissions";

// Fontes auto-hospedadas via next/font: sem @import bloqueante, sem FOUT.
// Inter para display/corpo (institucional, pesos calmos); JetBrains Mono
// para valores financeiros (números estáveis, fáceis de comparar).
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});
const mono = JetBrains_Mono({
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

// Aplica o tema antes da pintura para evitar "flash" (FOUC).
// Padrão = claro (identidade B2C: azul sobre branco); 'dark'/'system' respeitam a escolha do usuário.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)):false;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.remove('dark');}})();`;

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
    <html lang="pt-BR" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
