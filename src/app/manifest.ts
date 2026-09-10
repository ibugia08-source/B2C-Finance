import type { MetadataRoute } from "next";

/**
 * PWA INSTALÁVEL (F5.7 · para SDR e cobrança).
 *
 * O caso de uso que a spec nomeia é o celular do SDR (S2: atividade em 30
 * segundos) e o do cobrador (Modo Fila): instalado, o sistema abre em tela
 * cheia, sem barra de navegador, direto de um ícone.
 *
 * SEM service worker DE PROPÓSITO: instalabilidade não exige mais SW no
 * Chrome, e um SW de cache é uma promessa de offline que um sistema
 * financeiro multiusuário não deve fazer de graça — dado velho em tela de
 * cobrança é pior que tela de "sem conexão".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "B2C Finance",
    short_name: "B2C Finance",
    description: "Gestão financeira da B2C Gestão — clientes, cobranças, caixa e comercial.",
    start_url: "/",
    display: "standalone",
    lang: "pt-BR",
    // Papel da identidade "Clareza em movimento" (#0B192B azul profundo).
    background_color: "#0B192B",
    theme_color: "#0B192B",
    // O maskable é um arquivo À PARTE de propósito: o Android recorta o
    // ícone em círculo/squircle, e reaproveitar o `any` cortaria o
    // símbolo. Os PNG cobrem quem não instala a partir de SVG.
    icons: [
      { src: "/brand/b2c-finance/app/b2c-finance-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/b2c-finance/app/b2c-finance-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/b2c-finance/app/b2c-finance-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
