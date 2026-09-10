# B2C Finance — arquivos prontos para o rebranding

Esta é a nova identidade “Clareza em movimento”, preparada em 10/09/2026 a partir do pacote aprovado para instalação nesta conversa. O sistema ainda usa a identidade anterior; a alteração visual será feita no próximo trabalho de CSS/layout.

## Fonte de verdade

- Ativos servidos pela aplicação: `public/brand/b2c-finance/`.
- URL de uso: `/brand/b2c-finance/…` (não incluir `public` na URL).
- Índice tipado: `src/lib/branding/b2c-finance-assets.ts`.
- Inventário com dimensões, peso e aplicação: `docs/branding/b2c-finance/assets-manifest.json`.
- Cores em HEX e canais HSL: `docs/branding/b2c-finance/colors.json`.
- CSS de referência, ainda não importado: `docs/branding/b2c-finance/brand-tokens.reference.css`.
- Conceito e regras: `CONCEITO-E-APLICACOES.md`; prévias: `conceito.png` e `catalogo.png`.
- Originais e todas as exportações: `../identidade-visual/b2c-finance/pacote-completo/`, a partir da raiz do repositório.

## Escolha dos arquivos

| Aplicação | Arquivo preferido dentro de `/brand/b2c-finance/` | Exibição |
|---|---|---|
| Logo desktop | `logos/b2c-finance-logo-horizontal-light.svg` | 160 × 40 px |
| Logo tema escuro | `logos/b2c-finance-logo-horizontal-dark.svg` | 160 × 40 px |
| Menu | Mesmas logos horizontais | Até 180 × 45 px |
| Mobile | `logos/b2c-finance-logo-compacto-light.svg` ou `-dark.svg` | 112 × 28 px |
| Fundo azul | `logos/b2c-finance-logo-branco.svg` | 160 × 40 px |
| Símbolo | `symbols/b2c-finance-simbolo-light.svg` ou `-dark.svg` | 28–40 px |
| Estados vazios | `illustrations/b2c-finance-[estado]-light.svg` ou `-dark.svg` | 240 × 180 / 160 × 120 |
| Avatar IA | `assistant/b2c-finance-avatar-light.svg` ou `-dark.svg` | 40–64 px |
| Abertura IA | `illustrations/b2c-finance-assistente-inicial-light.svg` ou `-dark.svg` | 240 × 180 / 160 × 120 |
| Boas-vindas | `banners/b2c-finance-boas-vindas-desktop-light.svg` ou `-dark.svg` | 6:1 |
| Boas-vindas mobile | `banners/b2c-finance-boas-vindas-mobile-light.svg` ou `-dark.svg` | 3:1 |
| Login/recuperação | `auth/b2c-finance-login-desktop-light.svg` / `-mobile-light.svg`, também dark | 4:5 / 3:1 |
| E-mail | `logos/b2c-finance-logo-horizontal-light.png`, `email/b2c-finance-email-light.png` | 160 × 40 / 600 × 200 |
| Favicon | `app/b2c-finance-favicon.svg` e `.ico` | Automático / legado |
| App instalado | `app/b2c-finance-icon-192.png`, `-512.png`, `-maskable-512.png` | 1:1 |
| Prévia de link | `social/b2c-finance-compartilhamento.png` | 1200 × 630 |
| Carregamento | `assistant/b2c-finance-carregamento.svg` | 28–40 px |

Usar SVG como padrão: são ilustrações vetoriais simples, pequenas e independentes de densidade de tela. WebP de banners, acesso e cards é alternativa raster; não carregar SVG e WebP simultaneamente. PNG fica para e-mails, compatibilidade e metadados. O pacote completo com duplicatas e pranchas fica fora de `public`.

Os nomes usam minúsculas, hífens, prefixo `b2c-finance` e sufixo de tema. `light` significa fundo de destino claro; `dark`, fundo escuro. Na assinatura compacta, o texto visível é B2C; o texto alternativo continua “B2C Finance”.

## Orientação para a implementação futura

O projeto é Next.js 14 e Tailwind com `darkMode: ["class"]`. `src/app/globals.css` já define `--brand`, `--brand-hover`, `--brand-active`, `--brand-subtle`, `--brand-foreground` e os aliases `--primary`. As novas cores precisam ser mapeadas para esses tokens, usando os canais HSL de `colors.json`; não importar o CSS de referência como substituição completa de globals.css.

Reutilizar o controle de tema `.dark` existente. Variantes podem ser escolhidas com as classes de tema do projeto. Preservar layout intrínseco: `width`, `height`, `height:auto` e `object-fit:contain`. Não esticar logo ou recortar ilustrações. Usar a arte mobile própria de banner, não reduzir a desktop inteira. Manter textos, botões e números em HTML.

Preferir URLs de arquivo; não copiar SVGs grandes, PNGs base64 ou o catálogo para componentes. Carregar imagens de áreas fora da tela de forma preguiçosa. Não dar preload em toda a biblioteca. Importar apenas as URLs necessárias do índice. Não há nova dependência, fonte web ou biblioteca de ícones instalada.

Manter significado financeiro de verde/vermelho/âmbar, acessibilidade, teclado e os ícones funcionais que já atendem a navegação. Os 18 ícones novos são categorias do estudo, não um mapeamento validado dos 18 relatórios. As ilustrações não devem competir com filtros, tabelas e indicadores.

E-mail e Open Graph exigem URLs absolutas do domínio de produção na integração, não caminhos do computador. O arquivo de exemplo PWA do pacote original é apenas referência; ajustar os caminhos para os nomes instalados acima e integrar à metadata existente.

Após a integração visual, validar os temas e as larguras 360, 390, 768, 1024 e 1440 px. Rodar os checks existentes adequados à alteração. A preparação destes ativos não executa migrações, build, publicação nem alteração dos componentes atuais.
