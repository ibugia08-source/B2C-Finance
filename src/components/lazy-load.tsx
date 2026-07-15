"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface LazyLoadProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
  onVisible?: () => void;
  threshold?: number;
}

/**
 * LazyLoad: Intersection Observer based lazy loading
 * Loads content when it enters viewport
 */
export const LazyLoad = React.forwardRef<HTMLDivElement, LazyLoadProps>(
  ({ children, fallback, className, onVisible, threshold = 0.1 }, ref) => {
    const [isVisible, setIsVisible] = React.useState(false);
    const elementRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            onVisible?.();
            observer.unobserve(entry.target);
          }
        },
        { threshold }
      );

      if (elementRef.current) {
        observer.observe(elementRef.current);
      }

      return () => {
        if (elementRef.current) {
          observer.unobserve(elementRef.current);
        }
      };
    }, [onVisible, threshold]);

    return (
      <div ref={ref || elementRef} className={className}>
        {isVisible ? children : fallback}
      </div>
    );
  }
);

LazyLoad.displayName = "LazyLoad";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fallback?: string;
}

/**
 * LazyImage: Image with lazy loading + blur placeholder
 */
export const LazyImage = React.forwardRef<HTMLImageElement, LazyImageProps>(
  ({ src, alt, fallback, className, ...props }, ref) => {
    const [isLoaded, setIsLoaded] = React.useState(false);
    const [imageSrc, setImageSrc] = React.useState<string | null>(null);
    const elementRef = React.useRef<HTMLImageElement>(null);

    React.useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setImageSrc(src);
            observer.unobserve(entry.target);
          }
        },
        { threshold: 0.01 }
      );

      if (elementRef.current) {
        observer.observe(elementRef.current);
      }

      return () => {
        if (elementRef.current) {
          observer.unobserve(elementRef.current);
        }
      };
    }, [src]);

    return (
      <img
        ref={ref || elementRef}
        src={imageSrc || fallback}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        className={cn(
          "transition-opacity duration-300",
          !isLoaded && "blur-md opacity-50",
          isLoaded && "blur-0 opacity-100",
          className
        )}
        {...props}
      />
    );
  }
);

LazyImage.displayName = "LazyImage";
