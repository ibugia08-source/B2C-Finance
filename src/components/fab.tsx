"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface FABProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label?: string;
  variant?: "default" | "secondary" | "destructive";
  size?: "default" | "lg";
  position?: "bottom-right" | "bottom-left" | "bottom-center";
}

export const FAB = React.forwardRef<HTMLButtonElement, FABProps>(
  (
    {
      icon,
      label,
      variant = "default",
      size = "default",
      position = "bottom-right",
      className,
      ...props
    },
    ref
  ) => {
    const variantClasses = {
      default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg dark:shadow-lg dark:hover:shadow-xl",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-md hover:shadow-lg dark:shadow-lg dark:hover:shadow-xl",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md hover:shadow-lg dark:shadow-lg dark:hover:shadow-xl",
    };

    const sizeClasses = {
      default: "h-14 w-14 sm:h-16 sm:w-16",
      lg: "h-16 w-16 sm:h-20 sm:w-20",
    };

    const positionClasses = {
      "bottom-right": "fixed bottom-6 right-6 md:bottom-8 md:right-8",
      "bottom-left": "fixed bottom-6 left-6 md:bottom-8 md:left-8",
      "bottom-center": "fixed bottom-6 left-1/2 -translate-x-1/2 md:bottom-8",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "flex items-center justify-center rounded-full transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "active:scale-95",
          "z-40",
          variantClasses[variant],
          sizeClasses[size],
          positionClasses[position],
          // Safe area support for mobile notch/home bar
          "mb-[max(1.5rem,env(safe-area-inset-bottom))]",
          "mr-[max(1.5rem,env(safe-area-inset-right))]",
          "ml-[max(1.5rem,env(safe-area-inset-left))]",
          className
        )}
        title={label}
        aria-label={label || "Ação flutuante"}
        {...props}
      >
        <div className="flex items-center justify-center gap-2">
          {icon}
          {label && <span className="text-sm font-medium hidden sm:inline">{label}</span>}
        </div>
      </button>
    );
  }
);
FAB.displayName = "FAB";
