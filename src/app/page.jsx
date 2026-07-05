'use client';

import dynamic from 'next/dynamic';

// The whole tracker is interactive (window-driven routing, ResizeObserver,
// PostHog, etc.) so we skip SSR. Loading state is rendered until the bundle
// hydrates on the client.
const ClientApp = dynamic(() => import('./ClientApp'), {
  ssr: false,
  loading: () => null,
});

export default function HomePage() {
  return <ClientApp />;
}
