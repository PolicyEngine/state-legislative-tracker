'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import App from '../App';
import { DataProvider } from '../context/DataContext';

export default function ClientApp() {
  useEffect(() => {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (
      posthogKey &&
      process.env.NODE_ENV === 'production' &&
      !posthog.__loaded
    ) {
      posthog.init(posthogKey, {
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        session_recording: { maskAllInputs: true },
      });
    }
  }, []);

  return (
    <DataProvider>
      <App />
    </DataProvider>
  );
}
