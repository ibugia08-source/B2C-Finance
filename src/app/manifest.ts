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
    background_color: "#0d1b2e",
    theme_color: "#0d1b2e",
    icons: [
      { src: "/brand/symbol.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/symbol.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
