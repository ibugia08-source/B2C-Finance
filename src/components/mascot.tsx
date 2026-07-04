import { cn } from "@/lib/utils";

/**
 * Marca B2C Finance — assets em /public/brand.
 * Símbolo "B" hexagonal = logo. Mascote "B2C" (pato Old Money) = personagem/assistente.
 */

/** Símbolo "B" hexagonal (logo primária — sidebar, login, favicon). */
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
