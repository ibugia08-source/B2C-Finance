"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        // text-base (16px) no mobile evita zoom iOS; sm:text-sm para desktop.
        // h-11 (44px) para touch target mínimo; rounded-lg para design moderno.
        // NÃO usar `flex`: em <select> nativo com w-auto o flex colapsa a
        // largura e o valor selecionado some. inline-block é o correto.
        // SEM padding vertical (py-0): o navegador centraliza o texto pela
        // altura — py fixo cortava o texto em selects menores (h-7/h-8/h-9).
        "inline-block h-11 w-full rounded-lg border border-input bg-background px-3 py-0 text-base sm:text-sm leading-normal text-foreground ring-offset-background transition-colors duration-150 hover:border-muted-foreground/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";

export { Select };
