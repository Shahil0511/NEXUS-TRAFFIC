/**
 * Root layout (Server Component): fonts, global CSS, document metadata and the client providers.
 *
 * WHY DYNAMIC: reading the request headers makes every page render per request, which the
 * nonce-based CSP requires (src/proxy.ts sets `x-nonce`; Next applies the nonce to its own
 * scripts and next-themes receives it for its inline no-flash script).
 */
import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { AppProviders } from '@/components/AppProviders';
import { NONCE_HEADER } from '@/lib/csp';

import './globals.css';

/** Data Nexus brand typefaces — same as the portal shell and its other apps. */
const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Traffic · Data Nexus', template: '%s · Traffic · Data Nexus' },
  description: 'Real-time traffic analytics for the apps on nexus.libas.in.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#060608' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html
      lang="en-IN"
      suppressHydrationWarning
      className={`${jakarta.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full">
        <AppProviders nonce={nonce}>{children}</AppProviders>
      </body>
    </html>
  );
}
