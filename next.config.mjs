/** @type {import('next').NextConfig} */

/**
 * ROTAS APOSENTADAS (UX-01 · auditoria de 11/09/2026).
 *
 * Um link de notificação, de rotina ou de e-mail NÃO é código: ele fica
 * GRAVADO. A auditoria abriu uma notificação antiga e caiu em "Página não
 * encontrada" porque `/fila` (o Modo Fila) virou a régua dentro de
 * `/inadimplencia` — o código novo já não gera o link, mas as linhas
 * antigas do banco continuam apontando para lá, e vão continuar para
 * sempre.
 *
 * Por isso rota aposentada ganha redirecionamento PERMANENTE em vez de só
 * sumir. Regra ao mexer numa rota daqui para a frente: se ela já apareceu
 * em notificação, e-mail ou rotina, ela entra nesta tabela junto com o
 * commit que a renomeia. O teste tests/rotas-aposentadas.test.ts confere
 * que todo destino listado aqui existe de fato.
 */
export const ROTAS_APOSENTADAS = [
  // Modo Fila → a régua priorizada passou a viver na Inadimplência (F3.9).
  { origem: "/fila", destino: "/inadimplencia" },
  // A fila também era linkada com filtro; o destino preserva o contexto.
  { origem: "/fila/:resto*", destino: "/inadimplencia" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async redirects() {
    return ROTAS_APOSENTADAS.map(({ origem, destino }) => ({
      source: origem,
      destination: destino,
      permanent: true,
    }));
  },
};

export default nextConfig;
