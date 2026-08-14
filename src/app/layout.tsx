import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { getEnv } from '@/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'Viral Coin Radar',
  description:
    'Discovers, verifies, and ranks viral internet content that could inspire original meme-token concepts.',
};

/**
 * Persistent banner shown whenever any data on screen is synthetic. It is
 * rendered from server-side config rather than a client flag so it cannot be
 * dismissed or omitted by a page that happens to forget it.
 */
function DataModeBanner(): ReactNode {
  const env = getEnv();
  if (env.DATA_MODE !== 'fixture') return null;

  return (
    <div className="border-b border-caution/30 bg-caution/10 px-4 py-2">
      <p className="mx-auto max-w-[1400px] text-xs text-caution">
        <strong className="font-semibold">Demo data.</strong> No platform credentials are
        configured, so every post, metric, and token match on screen is a labelled synthetic
        fixture — not a real measurement. See{' '}
        <a href="/settings" className="underline underline-offset-2">
          Settings &amp; data-source health
        </a>{' '}
        for what live access requires.
      </p>
    </div>
  );
}

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Nav />
        <DataModeBanner />
        <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-[1400px] px-4 pt-4 pb-10">
          <p className="border-t border-hairline pt-4 text-xs leading-relaxed text-ink-faint">
            Viral Coin Radar is a research and idea-generation tool. View counts and engagement
            are not evidence that any token will perform, and nothing here is financial advice or
            a prediction of returns. Duplicate screening reports only what the searched index
            returned at the stated time — it can never prove a concept has not been used before.
          </p>
        </footer>
      </body>
    </html>
  );
}
