import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        // text-base (16px) no mobile evita o zoom automático do iOS ao focar; sm:text-sm mantém o visual do desktop
        // rounded-lg + hover/erro em linha com Input/Select (mesma família visual)
        "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background transition-colors duration-150 hover:border-muted-foreground/40 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
