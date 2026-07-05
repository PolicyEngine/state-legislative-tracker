// Production builds are static-exported so Modal can serve them as plain
// files (see modal_app.py): output goes to out/, and assets live under
// /_tracker because the policyengine.org proxy only forwards that prefix
// (plus /ingest and /api) to the Modal app. Dev keeps the normal Next
// server with the /ingest rewrite standing in for Modal's PostHog proxy.
const isProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isProd
    ? {
        output: 'export',
        assetPrefix: '/_tracker',
      }
    : {}),
  // Pin the workspace root so Turbopack does not silently pick up a stray
  // lockfile from a parent directory during local development or CI.
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
};

export default nextConfig;
