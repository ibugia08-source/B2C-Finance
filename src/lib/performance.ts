/**
 * Performance utilities for optimization
 */

/**
 * Debounce: Delay function execution until user stops interacting
 * Used for search, resize, scroll events
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle: Execute function at most once every X milliseconds
 * Used for scroll, resize, mouse move
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * RequestAnimationFrame throttle: Optimal for visual updates
 */
export function rafThrottle<T extends (...args: unknown[]) => unknown>(
  func: T
): (...args: Parameters<T>) => void {
  let frameId: number;
  return function executedFunction(...args: Parameters<T>) {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => func(...args));
  };
}

/**
 * Memoize: Cache function result based on arguments
 * Used for expensive computations
 */
export function memoize<T extends (...args: unknown[]) => unknown>(func: T): T {
  const cache = new Map();
  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = func(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

/**
 * RequestIdleCallback polyfill: Run non-critical tasks when browser is idle
 */
export function scheduleIdleTask(callback: () => void, timeout = 2000): void {
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, timeout);
  }
}

/**
 * Prefetch: Preload critical resources
 */
export function prefetchResource(url: string, type: "script" | "style" | "image" = "image"): void {
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(() => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = url;
      if (type !== "image") {
        link.as = type;
      }
      document.head.appendChild(link);
    });
  }
}

/**
 * Image loading strategy: Progressive JPEG or WebP
 */
export function getOptimalImageFormat(url: string): string {
  const supportsWebP = (canvas: HTMLCanvasElement) => {
    try {
      return canvas.toDataURL("image/webp").indexOf("webp") === 5;
    } catch {
      return false;
    }
  };

  if (typeof document !== "undefined" && supportsWebP(document.createElement("canvas"))) {
    return url.replace(/\.(jpg|jpeg|png)$/i, ".webp");
  }
  return url;
}

/**
 * Virtual scrolling helper: For long lists
 */
export interface VirtualListConfig {
  itemHeight: number;
  containerHeight: number;
  scrollTop: number;
  itemCount: number;
}

export function getVisibleRange(config: VirtualListConfig) {
  const { itemHeight, containerHeight, scrollTop, itemCount } = config;
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.ceil((scrollTop + containerHeight) / itemHeight);
  return {
    start: Math.max(0, startIndex - 1),
    end: Math.min(itemCount, endIndex + 1),
  };
}

/**
 * Memory efficient event delegation
 */
export function delegateEvent(
  selector: string,
  eventType: string,
  callback: (event: Event, element: Element) => void
): () => void {
  const handler = (e: Event) => {
    const target = (e.target as Element).closest(selector);
    if (target) {
      callback(e, target);
    }
  };

  document.addEventListener(eventType, handler);

  return () => {
    document.removeEventListener(eventType, handler);
  };
}
