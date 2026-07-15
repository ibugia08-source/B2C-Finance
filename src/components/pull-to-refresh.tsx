"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface PullToRefreshProps {
  children: React.ReactNode;
  onRefresh: () => Promise<void>;
  threshold?: number;
  className?: string;
}

const PULL_THRESHOLD = 80; // pixels to trigger refresh
const BOUNCE_DURATION = 200; // ms for bounce animation
const RESET_DURATION = 500; // ms to reset state

export const PullToRefresh = React.forwardRef<
  HTMLDivElement,
  PullToRefreshProps
>(({ children, onRefresh, threshold = PULL_THRESHOLD, className }, ref) => {
  const [pullDistance, setPullDistance] = React.useState(0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [showPull, setShowPull] = React.useState(false);
  const touchStartY = React.useRef(0);
  const scrollElement = React.useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only trigger on top of page
    if (scrollElement.current && scrollElement.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!scrollElement.current || scrollElement.current.scrollTop !== 0 || isRefreshing) {
      return;
    }

    const touchY = e.touches[0].clientY;
    const distance = Math.max(0, touchY - touchStartY.current);

    if (distance > 0) {
      e.preventDefault();
      setPullDistance(distance);
      setShowPull(distance > 20);
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setShowPull(false);

      try {
        await onRefresh();
      } catch (error) {
        console.error("Refresh error:", error);
      } finally {
        setPullDistance(0);
        setTimeout(() => setIsRefreshing(false), RESET_DURATION);
      }
    } else {
      setPullDistance(0);
      setShowPull(false);
    }
  };

  const pullProgress = Math.min(pullDistance / threshold, 1);
  const rotation = pullProgress * 180;

  return (
    <div
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      {showPull && (
        <div
          className="absolute inset-x-0 top-0 flex items-center justify-center transition-all"
          style={{
            height: `${pullDistance}px`,
            paddingBottom: "16px",
          }}
        >
          <div className="flex flex-col items-center gap-1">
            <RefreshCw
              size={20}
              className="text-primary transition-transform"
              style={{
                transform: `rotate(${rotation}deg)`,
              }}
            />
            <span className="text-xs text-muted-foreground font-medium">
              {pullDistance >= threshold ? "Release to refresh" : "Pull to refresh"}
            </span>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isRefreshing && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm" style={{ height: "60px" }}>
          <div className="flex flex-col items-center gap-1">
            <RefreshCw size={18} className="text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">Refreshing...</span>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollElement}
        className="overflow-y-auto transition-all"
        style={{
          transform: showPull ? `translateY(${pullDistance}px)` : "translateY(0)",
          transitionDuration: isRefreshing || pullDistance === 0 ? "0ms" : "200ms",
        }}
      >
        {children}
      </div>
    </div>
  );
});

PullToRefresh.displayName = "PullToRefresh";
