/**
 * Tema claro/escuro/sistema — fonte única (F1.14).
 *
 * O mesmo comportamento é acionado de três lugares (o seletor em
 * Configurações, a paleta de comandos e o script anti-flash do layout),
 * então a lógica mora aqui e não em cada um deles.
 */
export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "theme";

export function resolveIsDark(theme: Theme): boolean {
  return (
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveIsDark(theme));
}

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY) as Theme | null;
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  applyTheme(theme);
}

/** Alterna entre claro e escuro a partir do que está PINTADO agora. */
export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
  setTheme(next);
  return next;
}
