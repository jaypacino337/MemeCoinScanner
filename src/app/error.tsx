'use client';

import type { ReactNode } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return (
    <div className="rounded-lg border border-occupied/40 bg-occupied/5 px-4 py-6">
      <h2 className="text-sm font-semibold text-occupied">Something went wrong</h2>
      <p className="mt-2 text-sm text-ink-muted">{error.message}</p>
      {error.digest ? (
        <p className="mt-1 font-mono text-[11px] text-ink-faint">digest: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded border border-hairline-strong px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
