"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ScrollSnapProps {
  children: React.ReactNode;
  orientation?: "horizontal" | "vertical";
  snapType?: "mandatory" | "proximity";
  className?: string;
  containerClassName?: string;
}

/**
 * ScrollSnap: CSS scroll-snap container for carousel/gallery effects
 * Children should use scroll-snap-align:center or start
 */
export const ScrollSnap = React.forwardRef<HTMLDivElement, ScrollSnapProps>(
  (
    {
      children,
      orientation = "horizontal",
      snapType = "proximity",
      className,
      containerClassName,
    },
    ref
  ) => {
    const scrollSnapClasses = {
      horizontal: "scroll-snap-type-x-proximity flex overflow-x-auto gap-3",
      verticalMandatory: "scroll-snap-type-y-mandatory overflow-y-auto flex flex-col gap-3",
      verticalProximity: "scroll-snap-type-y-proximity overflow-y-auto flex flex-col gap-3",
    };

    const getContainerClass = () => {
      if (orientation === "horizontal") {
        return "scroll-snap-type-x-proximity flex overflow-x-auto gap-3";
      }
      return snapType === "mandatory"
        ? "scroll-snap-type-y-mandatory overflow-y-auto flex flex-col gap-3"
        : "scroll-snap-type-y-proximity overflow-y-auto flex flex-col gap-3";
    };

    return (
      <div
        ref={ref}
        className={cn(
          getContainerClass(),
          "snap-center snap-always pb-safe",
          containerClassName
        )}
        style={{
          scrollSnapType:
            orientation === "horizontal"
              ? `x ${snapType}`
              : `y ${snapType}`,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {React.Children.map(children, (child) => (
          <div
            className="snap-center flex-shrink-0"
            style={{ scrollSnapAlign: "center" }}
          >
            {child}
          </div>
        ))}
      </div>
    );
  }
);

ScrollSnap.displayName = "ScrollSnap";

interface ScrollSnapItemProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * ScrollSnapItem: Individual snap point in carousel
 */
export const ScrollSnapItem = React.forwardRef<
  HTMLDivElement,
  ScrollSnapItemProps
>(({ children, className }, ref) => (
  <div
    ref={ref}
    className={cn("flex-shrink-0 snap-center", className)}
    style={{ scrollSnapAlign: "center", scrollSnapStop: "always" }}
  >
    {children}
  </div>
));

ScrollSnapItem.displayName = "ScrollSnapItem";
