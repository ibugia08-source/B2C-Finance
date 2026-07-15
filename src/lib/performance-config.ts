/**
 * Performance configuration for Next.js app
 */

export const performanceConfig = {
  // Image optimization
  imageOptimization: {
    formats: ["image/avif", "image/webp"],
    sizes: {
      thumbnail: 150,
      small: 300,
      medium: 600,
      large: 1200,
      full: 1920,
    },
    quality: 80,
  },

  // Cache strategy
  cache: {
    // Stale-while-revalidate: Serve cached, fetch fresh in background
    swrDuration: 60, // seconds
    swrMaxAge: 3600, // seconds

    // Browser cache headers
    staticAssets: "public, max-age=31536000, immutable", // 1 year
    dynamicPages: "public, max-age=3600, s-maxage=3600", // 1 hour
    apiRoutes: "public, max-age=60, s-maxage=300", // 1 min / 5 min CDN
  },

  // Critical path resources
  criticalResources: [
    "/fonts/inter-var.woff2",
    "/images/logo.png",
  ],

  // Resource hints
  preconnect: [
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
  ],

  dns_prefetch: [
    "https://cdn.example.com",
    "https://analytics.example.com",
  ],

  // Web Vitals targets
  vitalsTargets: {
    LCP: 2500, // Largest Contentful Paint
    FID: 100, // First Input Delay
    CLS: 0.1, // Cumulative Layout Shift
    INP: 200, // Interaction to Next Paint
    TTFB: 600, // Time to First Byte
  },

  // Lighthouse targets
  lighthouseTargets: {
    performance: 75,
    accessibility: 90,
    bestPractices: 90,
    seo: 90,
  },
};

/**
 * Optimization strategies
 */
export const optimizationStrategies = {
  // Code splitting
  codeSplitting: {
    enabled: true,
    threshold: 50000, // bytes
    chunks: "all",
  },

  // Compression
  compression: {
    gzip: true,
    brotli: true,
    level: 11,
  },

  // Minification
  minification: {
    enabled: true,
    removeConsole: true, // Remove console.log in production
    removeDebugger: true,
  },

  // Tree shaking
  treeShaking: {
    enabled: true,
    sideEffects: false,
  },

  // CSS optimization
  cssOptimization: {
    enabled: true,
    critical: true, // Inline critical CSS
    purge: true, // Remove unused CSS
  },

  // JavaScript optimization
  jsOptimization: {
    enabled: true,
    removeDeadCode: true,
    inlineRuntime: true,
  },
};

/**
 * Get cache header based on resource type
 */
export function getCacheHeader(type: "static" | "dynamic" | "api"): string {
  return performanceConfig.cache[
    `${type}Assets` as keyof typeof performanceConfig.cache
  ] as string;
}

/**
 * Check if URL is critical resource
 */
export function isCriticalResource(url: string): boolean {
  return performanceConfig.criticalResources.some((resource) =>
    url.includes(resource)
  );
}
