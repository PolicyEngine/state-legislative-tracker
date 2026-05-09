import Script from 'next/script';
import './globals.css';

const SITE_URL = 'https://www.policyengine.org/us/state-legislative-tracker';
const TITLE = '2026 State Legislative Tracker | PolicyEngine US';
const DESCRIPTION =
  'Track state-level tax and benefit legislation across all 50 states. See fiscal impacts, winners and losers, and district-level analysis powered by PolicyEngine microsimulation.';
const OG_TITLE = '2026 State Legislative Tracker | PolicyEngine';
const OG_IMAGE = 'https://policyengine.org/assets/posts/state-legislative-tracker.png';
const GA_MEASUREMENT_ID = 'G-2YHG89FY0N';
const TOOL_NAME = 'state-legislative-tracker';

export const metadata = {
  metadataBase: new URL('https://www.policyengine.org'),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'state legislation tracker',
    'tax policy',
    'state tax bills',
    'fiscal impact analysis',
    'PolicyEngine',
    'microsimulation',
    'EITC',
    'child tax credit',
    'income tax reform',
    '2026 legislative session',
  ],
  authors: [{ name: 'PolicyEngine' }],
  robots: 'index, follow',
  alternates: {
    canonical: SITE_URL,
  },
  verification: {
    google: 'yPFrltKCrAwfFqVv0l2yJVPokUucON17oNFquEu_Zeg',
  },
  openGraph: {
    type: 'website',
    title: OG_TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: 'PolicyEngine State Legislative Tracker',
    locale: 'en_US',
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'PolicyEngine State Legislative Tracker - interactive map showing state tax policy analysis across the US',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@ThePolicyEngine',
    title: OG_TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        alt: 'PolicyEngine State Legislative Tracker - interactive map showing state tax policy analysis across the US',
      },
    ],
  },
  icons: {
    icon: '/policyengine-favicon.svg',
  },
};

export const viewport = {
  themeColor: '#2C7A7B',
  width: 'device-width',
  initialScale: 1,
};

const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'PolicyEngine',
  url: 'https://policyengine.org',
  logo: 'https://policyengine.org/assets/policyengine-logo.svg',
  sameAs: [
    'https://twitter.com/ThePolicyEngine',
    'https://github.com/policyengine',
  ],
};

const appJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: '2026 State Legislative Tracker',
  description: DESCRIPTION,
  url: SITE_URL,
  applicationCategory: 'GovernmentApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  author: {
    '@type': 'Organization',
    name: 'PolicyEngine',
    url: 'https://policyengine.org',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://ffgngqlgfsvqartilful.supabase.co"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link
          rel="dns-prefetch"
          href="https://www.googletagmanager.com"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }}
        />
      </head>
      <body>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}', { tool_name: '${TOOL_NAME}' });
          `}
        </Script>
        <Script id="ga-engagement" strategy="afterInteractive">
          {`
            (function() {
              var TOOL_NAME = '${TOOL_NAME}';
              if (typeof window === 'undefined' || !window.gtag) return;

              var scrollFired = {};
              window.addEventListener('scroll', function() {
                var docHeight = document.documentElement.scrollHeight - window.innerHeight;
                if (docHeight <= 0) return;
                var pct = Math.floor((window.scrollY / docHeight) * 100);
                [25, 50, 75, 100].forEach(function(m) {
                  if (pct >= m && !scrollFired[m]) {
                    scrollFired[m] = true;
                    window.gtag('event', 'scroll_depth', { percent: m, tool_name: TOOL_NAME });
                  }
                });
              }, { passive: true });

              [30, 60, 120, 300].forEach(function(sec) {
                setTimeout(function() {
                  if (document.visibilityState !== 'hidden') {
                    window.gtag('event', 'time_on_tool', { seconds: sec, tool_name: TOOL_NAME });
                  }
                }, sec * 1000);
              });

              document.addEventListener('click', function(e) {
                var link = e.target && e.target.closest ? e.target.closest('a') : null;
                if (!link || !link.href) return;
                try {
                  var url = new URL(link.href, window.location.origin);
                  if (url.hostname && url.hostname !== window.location.hostname) {
                    window.gtag('event', 'outbound_click', {
                      url: link.href,
                      target_hostname: url.hostname,
                      tool_name: TOOL_NAME
                    });
                  }
                } catch (err) {}
              });
            })();
          `}
        </Script>
        {children}
        <noscript>
          <div
            style={{
              maxWidth: 800,
              margin: '40px auto',
              padding: 20,
              fontFamily: 'Inter, sans-serif',
              textAlign: 'center',
            }}
          >
            <h1>2026 State Legislative Tracker | PolicyEngine</h1>
            <p>
              Track state-level tax and benefit legislation across all 50
              states. See fiscal impacts, winners and losers, and district-level
              analysis powered by PolicyEngine microsimulation.
            </p>
            <p>
              This application requires JavaScript to run. Please enable
              JavaScript in your browser settings.
            </p>
            <p>
              <a href="https://policyengine.org">Visit PolicyEngine.org</a>
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
