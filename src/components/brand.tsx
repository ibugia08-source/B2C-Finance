/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { b2cFinanceAssets } from "@/lib/branding/b2c-finance-assets";

/**
 * MARCA B2C FINANCE — "Clareza em movimento".
 *
 * Ponto único de aplicação da identidade na interface. Regras que este
 * arquivo existe para garantir (docs/branding/b2c-finance/):
 *
 *  · SVG sempre, servido por URL de /public — nada de base64 nem de
 *    importar o catálogo inteiro para o bundle.
 *  · Proporção intrínseca preservada: `width`/`height` reais e
 *    `object-contain`. A marca não estica e não recorta.
 *  · Variante por TEMA, não por preferência do sistema: o produto troca
 *    `.dark` na raiz, então as duas artes vão ao DOM e o CSS mostra uma.
 *    É o que evita o piscar da arte errada antes da hidratação — são
 *    dois SVGs de ~1-5 KB, mais baratos que um flash.
 *  · Ilustração é decorativa: `alt=""` e o texto ao lado explica o
 *    estado. Nunca a imagem sozinha comunicando erro, êxito ou permissão.
 *  · No PAPEL vale sempre a arte clara: `brand-art-light/dark` deixa o
 *    @media print de globals.css forçar a variante certa, senão quem
 *    imprime no tema escuro leva a logo clara sobre folha branca.
 *
 * Nada aqui é client component: são tags `img` puras, usáveis do servidor.
 */

type Fontes = { svg?: string; png?: string; webp?: string; ico?: string };
const ATIVOS = b2cFinanceAssets as unknown as Record<string, Fontes>;

/** Bases com par claro/escuro no índice (o sufixo entra aqui). */
type BaseTematica =
  keyof typeof b2cFinanceAssets extends infer K
    ? K extends `${infer B}-light`
      ? B
      : never
    : never;

function porTema(base: BaseTematica): { light: string; dark: string } {
  return {
    light: ATIVOS[`${base}-light`]!.svg!,
    dark: ATIVOS[`${base}-dark`]!.svg!,
  };
}

/**
 * Par claro/escuro no DOM, um visível por vez. `alt` vai nos dois: só um
 * está renderizado, então o leitor de tela anuncia uma vez só.
 *
 * `className` serve para TAMANHO, espaçamento e posição — nunca para
 * display. Um `lg:hidden` vindo de fora colide com o `dark:block` daqui e
 * a arte reaparece onde não devia; para esconder, envolva a chamada.
 */
function ImagemPorTema({
  base,
  alt,
  width,
  height,
  className,
  loading,
}: {
  base: BaseTematica;
  alt: string;
  width: number;
  height: number;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const { light, dark } = porTema(base);
  const comum = cn("select-none object-contain", className);
  return (
    <>
      <img
        src={light}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        draggable={false}
        className={cn(comum, "brand-art-light dark:hidden")}
      />
      <img
        src={dark}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        draggable={false}
        className={cn(comum, "brand-art-dark hidden dark:block")}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Logotipos                                                           */
/* ------------------------------------------------------------------ */

/**
 * Assinatura completa (símbolo + "B2C Finance"), prancheta 4:1.
 * Desktop 160 × 40; menu até 180 × 45.
 */
export function BrandLogo({
  height = 40,
  className,
  loading,
}: {
  height?: number;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  return (
    <ImagemPorTema
      base="logos/b2c-finance-logo-horizontal"
      alt="B2C Finance"
      width={height * 4}
      height={height}
      className={cn("shrink-0", className)}
      loading={loading}
    />
  );
}

/**
 * Assinatura compacta (símbolo + "B2C"), 112 × 28 — cabeçalho mobile.
 * O texto visível é "B2C"; o nome acessível continua "B2C Finance".
 */
export function BrandLogoCompact({
  height = 28,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <ImagemPorTema
      base="logos/b2c-finance-logo-compacto"
      alt="B2C Finance"
      width={height * 4}
      height={height}
      className={cn("shrink-0", className)}
    />
  );
}

/** Assinatura branca — só sobre o azul institucional ou fundo escuro sólido. */
export function BrandLogoWhite({
  height = 40,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      src={ATIVOS["logos/b2c-finance-logo-branco"]!.svg}
      alt="B2C Finance"
      width={height * 4}
      height={height}
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}

/** Símbolo isolado (os dois caminhos abertos) — 28 a 40 px. */
export function BrandSymbol({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <ImagemPorTema
      base="symbols/b2c-finance-simbolo"
      alt="B2C Finance"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Ilustrações                                                         */
/* ------------------------------------------------------------------ */

/** Famílias de ilustração 4:3 disponíveis no pacote. */
export type BrandIllustrationName =
  | "acesso-negado"
  | "assistente-inicial"
  | "contratos"
  | "erro"
  | "funil"
  | "importacao"
  | "leads"
  | "manutencao"
  | "notificacoes"
  | "relatorios-agendados"
  | "reservas"
  | "rotina-concluida"
  | "sem-dados";

/**
 * Ilustração de estado (vazio, erro, permissão). Decorativa por
 * definição: o título e a ação ao lado é que carregam a informação.
 * Tamanhos do manual: 240 × 180 (padrão) e 160 × 120 (compacto).
 */
export function BrandIllustration({
  name,
  width = 240,
  className,
}: {
  name: BrandIllustrationName;
  /** Largura em px; a altura acompanha a proporção 4:3 da prancheta. */
  width?: number;
  className?: string;
}) {
  return (
    <ImagemPorTema
      base={`illustrations/b2c-finance-${name}` as BaseTematica}
      alt=""
      width={width}
      height={Math.round((width * 3) / 4)}
      className={cn("max-w-full", className)}
      loading="lazy"
    />
  );
}

/** Painel ilustrado do acesso — 4:5 no desktop, 3:1 no celular. */
export function BrandAuthPanel({
  variant,
  className,
}: {
  variant: "desktop" | "mobile";
  className?: string;
}) {
  const desktop = variant === "desktop";
  return (
    <ImagemPorTema
      base={
        (desktop
          ? "auth/b2c-finance-login-desktop"
          : "auth/b2c-finance-login-mobile") as BaseTematica
      }
      alt=""
      width={desktop ? 1200 : 1080}
      height={desktop ? 1500 : 360}
      className={className}
      loading={desktop ? "lazy" : "eager"}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Assistente                                                          */
/* ------------------------------------------------------------------ */

/** Avatar do Assistente B2C — 40 a 64 px (tem fundo próprio). */
export function AssistantAvatar({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <ImagemPorTema
      base="assistant/b2c-finance-avatar"
      alt="Assistente B2C"
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", className)}
    />
  );
}

/**
 * Marca de carregamento. O SVG pulsa e já traz o próprio bloco
 * `prefers-reduced-motion` — quem pediu menos movimento vê o desenho
 * parado, não a ausência dele. O estado ainda precisa de texto:
 * `role="status"` com rótulo, e não só o desenho.
 */
export function BrandLoader({
  size = 32,
  label = "Carregando…",
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2", className)}>
      <img
        src={ATIVOS["assistant/b2c-finance-carregamento"]!.svg}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="select-none object-contain"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
