"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ResponsiveTableProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * ResponsiveTableWrapper: Switches between table (desktop) and card stack (mobile)
 * Usage:
 * <ResponsiveTableWrapper>
 *   <Table>table content</Table>
 *   <CardStack>card content</CardStack>
 * </ResponsiveTableWrapper>
 */
export function ResponsiveTableWrapper({ children, className }: ResponsiveTableProps) {
  return <div className={className}>{children}</div>;
}

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

/**
 * ResponsiveTable: Desktop table that hides on mobile
 */
export function ResponsiveTable({ className, ...props }: TableProps) {
  return (
    <div className="hidden md:block overflow-x-auto rounded-lg border">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

interface CardStackProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * CardStack: Mobile card list that hides on desktop
 * Each card represents a table row
 */
export function CardStack({ children, className }: CardStackProps) {
  return (
    <div className={cn("md:hidden space-y-3 fade-scale-in", className)}>
      {children}
    </div>
  );
}

interface CardRowProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * CardRow: Individual card for mobile view (represents one table row)
 * Usage:
 * <CardRow>
 *   <CardField label="Name" value="John Doe" />
 *   <CardField label="Email" value="john@example.com" />
 *   <CardActions>{actions}</CardActions>
 * </CardRow>
 */
export function CardRow({ children, className }: CardRowProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 sm:p-4 space-y-2 transition-smooth hover-lift hover:shadow-soft",
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardFieldProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

/**
 * CardField: Label + value pair for mobile card
 */
export function CardField({ label, value, className }: CardFieldProps) {
  return (
    <div className={cn("flex items-center justify-between gap-2 pb-2 border-b last:border-0", className)}>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

interface CardActionsProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * CardActions: Actions row at bottom of card (edit, delete, etc)
 */
export function CardActions({ children, className }: CardActionsProps) {
  return (
    <div className={cn("flex items-center gap-2 pt-2 border-t", className)}>
      {children}
    </div>
  );
}
