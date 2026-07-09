"use client";
import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Checkbox leve (input nativo estilizado) alinhado ao Design System B2C.
 * Suporta estado indeterminado (seleção parcial no cabeçalho da tabela).
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, checked, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);
    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = !!indeterminate;
    }, [indeterminate]);

    return (
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          ref={innerRef}
          type="checkbox"
          checked={checked}
          className={cn(
            "peer h-4 w-4 cursor-pointer appearance-none rounded-[5px] border border-input bg-background transition-colors",
            "checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <span className="pointer-events-none absolute text-primary-foreground opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        {indeterminate && (
          <span className="pointer-events-none absolute text-primary-foreground">
            <Minus className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </span>
    );
  }
);
Checkbox.displayName = "Checkbox";
