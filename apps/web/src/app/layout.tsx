import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/components/app-providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daktari Mkononi Portal',
  description: 'Administrative and clinical console for Daktari Mkononi.',
  // An internal console must never end up in a search index.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
