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

/**
 * Base absoluta da metadata. Favicon e prévia de link precisam de URL
 * ABSOLUTA para o WhatsApp, o Slack e o cliente de e-mail resolverem a
 * imagem — caminho relativo funciona no navegador e quebra fora dele.
 * Em produção a Vercel injeta o domínio; no dev cai no servidor local.
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3100");

const DESCRICAO =
  "B2C Finance: a plataforma financeira da B2C Gestão — clientes, contratos, cobranças, caixa, folha, relatórios e copiloto de IA.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Sem `template`: as páginas já assinam o próprio título com
  // "— B2C Finance", e um sufixo automático duplicaria a marca na aba.
  title: "B2C Finance — Gestão financeira da B2C Gestão",
  description: DESCRICAO,
  applicationName: "B2C Finance",
  // Ícones da identidade "Clareza em movimento". O SVG serve o navegador
  // moderno (e troca sozinho no tema escuro); PNG e ICO ficam para quem
  // não lê SVG em favicon.
  icons: {
    icon: [
      { url: "/brand/b2c-finance/app/b2c-finance-favicon.svg", type: "image/svg+xml" },
      { url: "/brand/b2c-finance/app/b2c-finance-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/b2c-finance/app/b2c-finance-icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/b2c-finance/app/b2c-finance-favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/brand/b2c-finance/app/b2c-finance-icon-180.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "B2C Finance",
    title: "B2C Finance — Gestão financeira da B2C Gestão",
    description: DESCRICAO,
    locale: "pt_BR",
    images: [
      {
        url: "/brand/b2c-finance/social/b2c-finance-compartilhamento.png",
        width: 1200,
        height: 630,
        alt: "B2C Finance",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "B2C Finance — Gestão financeira da B2C Gestão",
    description: DESCRICAO,
    images: ["/brand/b2c-finance/social/b2c-finance-compartilhamento.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  // Barra do navegador no mesmo papel da tela: #F5F8FC / #0B192B.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F8FC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B192B" },
  ],
};

// Aplica o tema ANTES da pintura (sem flash). O seletor de acento saiu no
// F1.13 — acento único (02 §7.2) — e este script LIMPA o data-accent que
// tenha ficado gravado em navegadores da versão anterior.
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.removeAttribute('data-accent');localStorage.removeItem('b2c:accent');}catch(e){document.documentElement.classList.remove('dark');}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cu = await getCurrentUser();
  // Escopo organizacional da barra global — some sozinho quando há só
  // uma entidade e uma agência (ver services/org-scope.ts).
  //
  // FALHA SUAVE, como o contador do sino logo abaixo: é dado de CASCA, e
  // /login nem chega a renderizar a casca. Sem o catch, um banco fora do
  // ar derrubava justamente a tela de entrada — a única que alguém abre
  // quando nada mais funciona.
  const scopeOptions = await getScopeOptions().catch(() => ({
    entities: [],
    agencies: [],
    multiple: false,
  }));
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
