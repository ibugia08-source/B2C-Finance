"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface SwipeGestureProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
  className?: string;
}

const SWIPE_THRESHOLD = 50; // pixels to register a swipe
const SWIPE_TIME_THRESHOLD = 500; // ms for swipe detection

export const SwipeGesture = React.forwardRef<
  HTMLDivElement,
  SwipeGestureProps
>(
  (
    {
      children,
      onSwipeLeft,
      onSwipeRight,
      onSwipeUp,
      onSwipeDown,
      threshold = SWIPE_THRESHOLD,
      className,
    },
    ref
  ) => {
    const touchStart = React.useRef({ x: 0, y: 0, time: 0 });

    const handleTouchStart = (e: React.TouchEvent) => {
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchEnd = {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY,
        time: Date.now(),
      };

      const dx = touchStart.current.x - touchEnd.x;
      const dy = touchStart.current.y - touchEnd.y;
      const timeDiff = touchEnd.time - touchStart.current.time;

      // Check if swipe is fast enough
      if (timeDiff > SWIPE_TIME_THRESHOLD) {
        return;
      }

      // Horizontal swipes
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > threshold && onSwipeLeft) {
          onSwipeLeft();
        } else if (dx < -threshold && onSwipeRight) {
          onSwipeRight();
        }
      }
      // Vertical swipes
      else {
        if (dy > threshold && onSwipeUp) {
          onSwipeUp();
        } else if (dy < -threshold && onSwipeDown) {
          onSwipeDown();
        }
      }
    };

    return (
      <div
        ref={ref}
        className={cn("select-none", className)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    );
  }
);

SwipeGesture.displayName = "SwipeGesture";
