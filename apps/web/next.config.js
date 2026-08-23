/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output mode
  output: 'standalone',

  // React strict mode for better development
  reactStrictMode: true,

  // Skip type checking during build (faster deploys)
  // Type errors caught in dev, not blocking production
  typescript: {
    ignoreBuildErrors: true,
  },

  // Skip ESLint during build (faster deploys)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Experimental features
  experimental: {
    typedRoutes: false,
  },

  // Images configuration
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**.railway.app' },
      { protocol: 'https', hostname: '**.onrender.com' },
      { protocol: 'https', hostname: '**.vercel.app' },
    ],
  },

  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },

  // Transpile shared package (monorepo)
  transpilePackages: ['@mcap/shared'],
};

module.exports = nextConfig;