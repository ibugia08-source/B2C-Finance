import { cn } from "@/lib/utils";

/**
 * Marca B2C — assets em /public/brand.
 * Logomarca oficial = wordmark "B2C" (B2CLogo). Mascote = personagem/assistente.
 */

/**
 * Logomarca oficial da B2C — wordmark "B2C".
 * Inline SVG (herda a Inter 900 do app) para fidelidade em qualquer tamanho.
 * variant "blue" = azul sobre branco (padrão) · "white" = para fundos azuis.
 * Não distorcer, cortar ou aplicar efeitos (diretriz de marca).
 */
export function B2CLogo({
  height = 28,
  variant = "blue",
  className,
}: {
  height?: number;
  variant?: "blue" | "white";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 120"
      height={height}
      width={(height * 320) / 120}
      role="img"
      aria-label="B2C"
      className={cn("shrink-0 select-none", className)}
    >
      <text
        x="50%"
        y="97"
        textAnchor="middle"
        textLength="300"
        lengthAdjust="spacingAndGlyphs"
        fontFamily="Inter, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"
        fontWeight={900}
        fontSize={118}
        letterSpacing={-3}
        fill={variant === "white" ? "#FFFFFF" : "#1E70D3"}
      >
        B2C
      </text>
    </svg>
  );
}

/** Símbolo "B" hexagonal (legado — preferir B2CLogo). */
export function B2CSymbol({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/symbol.svg"
      alt="B2C Finance"
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

/** Avatar do mascote (rosto) — ideal para avatares pequenos (Assistente). */
export function B2CAvatar({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/mascot/avatar.png"
      alt="B2C"
      width={size}
      height={size}
      className={cn("shrink-0 select-none object-contain", className)}
      draggable={false}
    />
  );
}

/**
 * Mascote principal — B2C com o tablet de analytics (pose herói).
 * Usado no login, empty states e destaques.
 */
export function B2CMascot({
  width = 180,
  pose = "hero",
  className,
}: {
  width?: number;
  pose?: "hero" | "welcome" | "full";
  className?: string;
}) {
  const src =
    pose === "welcome"
      ? "/brand/mascot/welcome.png"
      : pose === "full"
        ? "/brand/mascot/full.png"
        : "/brand/mascot/hero.png";
  return (
    <img
      src={src}
      alt="B2C — seu copiloto financeiro"
      width={width}
      className={cn("select-none object-contain", className)}
      draggable={false}
    />
  );
}

/** Alias de compatibilidade. */
export const B2CMascotFull = B2CMascot;
