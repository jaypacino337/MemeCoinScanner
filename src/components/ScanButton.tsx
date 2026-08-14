'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

interface ScanResponse {
  scanRunId?: string;
  fixtureMode?: boolean;
  accepted?: number;
  rejected?: number;
  error?: string;
  detail?: string;
}

/** Triggers a scan and refreshes the server components once it completes. */
export function ScanButton({
  filters,
  label = 'Run scan',
}: {
  filters?: Record<string, unknown>;
  label?: string;
}): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function run(): Promise<void> {
    setRunning(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(filters ?? {}),
      });
      const body = (await response.json()) as ScanResponse;

      if (!response.ok) {
        setIsError(true);
        setMessage(
          response.status === 429
            ? `Rate limited. ${body.detail ?? 'Try again shortly.'}`
            : `${body.error ?? 'Scan failed'}${body.detail ? `: ${body.detail}` : ''}`,
        );
        return;
      }

      setMessage(`${body.accepted ?? 0} accepted, ${body.rejected ?? 0} filtered out.`);
      startTransition(() => router.refresh());
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Network error');
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Scanning…' : label}
      </button>
      {message ? (
        <span className={`text-[11px] ${isError ? 'text-occupied' : 'text-ink-muted'}`}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
