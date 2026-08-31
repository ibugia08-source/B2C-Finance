import type { Config } from "tailwindcss";

/**
 * FUNDAÇÕES DE DESIGN — B2C Finance 2.2 (F1.13 · ref. 02 §7.2).
 *
 * Nenhuma cor literal mora aqui: tudo aponta para os tokens semânticos de
 * globals.css, que por sua vez derivam das escalas primitivas. É o que
 * permite trocar o tema inteiro em um arquivo e o que a trava de tokens
 * (scripts/check-design-tokens.mjs) fiscaliza.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    // src/lib carrega classes de UI (ex.: tinturas ROW_PAID/ROW_SOON/
    // ROW_OVERDUE em lib/status-meta.ts) — sem escanear, o JIT não as gera.
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    screens: {
      xs: "375px",   // iPhone SE base
      sm: "640px",
      md: "768px",   // tablet
      lg: "1024px",  // laptop
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      fontFamily: {
        // 02 §7.2: Inter na interface, JetBrains Mono tabular em TODO número
        // financeiro. Só duas famílias — `display` é alias de compatibilidade
        // com o legado e aponta para a mesma Inter.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        /* ---- superfícies ---- */
        canvas: "hsl(var(--canvas))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          raised: "hsl(var(--surface-raised))",
          sunken: "hsl(var(--surface-sunken))",
          soft: "hsl(var(--surface-soft))",
          strong: "hsl(var(--surface-strong))",
        },
        /* ---- traços ---- */
        border: "hsl(var(--border))",
        "border-soft": "hsl(var(--border-soft))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        /* ---- tinta: text/text-muted da spec são foreground/muted-foreground ---- */
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        faint: "hsl(var(--text-faint))",
        /* ---- acento único da marca ---- */
        brand: {
          DEFAULT: "hsl(var(--brand))",
          hover: "hsl(var(--brand-hover))",
          active: "hsl(var(--brand-active))",
          subtle: "hsl(var(--brand-subtle))",
          foreground: "hsl(var(--brand-foreground))",
        },
        /* ---- território de marca: login, PDF, e-mail (nunca no produto) ---- */
        navy: { DEFAULT: "hsl(var(--navy))", deep: "hsl(var(--navy-deep))" },
        gold: "hsl(var(--gold))",
        /* ---- semântica de estado ---- */
        success: {
          DEFAULT: "hsl(var(--success))",
          soft: "hsl(var(--success-soft))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          soft: "hsl(var(--warning-soft))",
          foreground: "hsl(var(--warning-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          soft: "hsl(var(--danger-soft))",
          foreground: "hsl(var(--danger-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          soft: "hsl(var(--info-soft))",
          foreground: "hsl(var(--info-foreground))",
        },
        /* ---- dataviz: 6 séries validadas (02 §7.4) ---- */
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
          grid: "hsl(var(--chart-grid))",
        },
        /* ---- aliases shadcn: o legado depende destes nomes ---- */
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          active: "hsl(var(--primary-active))",
          disabled: "hsl(var(--primary-disabled))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        pill: "var(--radius-pill)",
        cell: "var(--radius-cell)",     // 8px  células editáveis
        input: "var(--radius-input)",   // 12px inputs
        card: "var(--radius-card)",     // 16px cards
        modal: "var(--radius-modal)",   // 24px modais
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontSize: {
        // Escala de 02 §7.2 — nomes semânticos primeiro.
        caption: ["12px", { lineHeight: "16px" }],
        dense: ["13px", { lineHeight: "18px" }],
        body: ["14px", { lineHeight: "20px" }],
        emphasis: ["16px", { lineHeight: "24px" }],
        section: ["20px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
        page: ["24px", { lineHeight: "32px", letterSpacing: "-0.02em" }],
        value: ["32px", { lineHeight: "38px", letterSpacing: "-0.02em" }],
        "value-lg": ["44px", { lineHeight: "48px", letterSpacing: "-0.02em" }],
        // Numéricos do legado (mantidos: centenas de usos).
        xs: ["12px", "16px"],
        sm: ["14px", "20px"],
        base: ["16px", "24px"],
        lg: ["18px", "28px"],
        xl: ["20px", "28px"],
        "2xl": ["24px", "32px"],
        "3xl": ["30px", "36px"],
        "4xl": ["36px", "40px"],
      },
      maxWidth: {
        content: "1440px", // teto de conteúdo (02 §7.2)
        doc: "880px",      // leitura de documento
      },
      minHeight: { touch: "44px", "touch-sm": "40px" },
      minWidth: { touch: "44px", "touch-sm": "40px" },
      transitionDuration: {
        instant: "80ms",
        fast: "140ms",
        base: "200ms",
        slow: "280ms",
        300: "300ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        decelerate: "cubic-bezier(0.05, 0.7, 0.1, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
