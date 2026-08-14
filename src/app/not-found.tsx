import Link from 'next/link';
import type { ReactNode } from 'react';

export default function NotFound(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <p className="font-mono text-sm text-ink-faint">404</p>
      <h1 className="text-lg font-semibold text-ink">Page not found</h1>
      <Link href="/" className="text-sm text-accent hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
