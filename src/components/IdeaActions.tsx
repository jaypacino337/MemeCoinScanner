'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

/** Save / reject / rescan controls on the idea detail page. */
export function IdeaActions({
  candidateId,
  originalUrl,
  initiallySaved,
  initiallyRejected,
}: {
  candidateId: string;
  originalUrl: string;
  initiallySaved: boolean;
  initiallyRejected: boolean;
}): ReactNode {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(initiallySaved);
  const [rejected, setRejected] = useState(initiallyRejected);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function call(
    action: string,
    path: string,
    method: 'POST' | 'DELETE',
    body?: unknown,
  ): Promise<unknown | null> {
    setBusy(action);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = data as { error?: string; detail?: string };
        setIsError(true);
        setMessage(`${err.error ?? 'Request failed'}${err.detail ? `: ${err.detail}` : ''}`);
        return null;
      }
      startTransition(() => router.refresh());
      return data;
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Network error');
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <a
          href={originalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
        >
          Open original post ↗
        </a>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void call('rescan', `/api/candidates/${candidateId}/rescan`, 'POST').then((data) => {
              const result = data as { message?: string } | null;
              if (result) setMessage(result.message ?? 'Metrics refreshed');
            });
          }}
          className="rounded border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {busy === 'rescan' ? 'Rescanning…' : 'Rescan metrics'}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            const next = !saved;
            void call(
              'save',
              `/api/candidates/${candidateId}/save`,
              next ? 'POST' : 'DELETE',
            ).then((data) => {
              if (data) {
                setSaved(next);
                if (next) setRejected(false);
                setMessage(next ? 'Saved.' : 'Removed from saved.');
              }
            });
          }}
          className={`rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            saved
              ? 'border-clean/50 bg-clean/10 text-clean'
              : 'border-hairline-strong text-ink-muted hover:border-clean hover:text-clean'
          }`}
        >
          {busy === 'save' ? '…' : saved ? '✓ Saved' : 'Save idea'}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            const next = !rejected;
            void call(
              'reject',
              `/api/candidates/${candidateId}/reject`,
              next ? 'POST' : 'DELETE',
              next ? { reason: 'Marked weak by user' } : undefined,
            ).then((data) => {
              if (data) {
                setRejected(next);
                if (next) setSaved(false);
                setMessage(next ? 'Marked as weak.' : 'Rejection cleared.');
              }
            });
          }}
          className={`rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            rejected
              ? 'border-occupied/50 bg-occupied/10 text-occupied'
              : 'border-hairline-strong text-ink-muted hover:border-occupied hover:text-occupied'
          }`}
        >
          {busy === 'reject' ? '…' : rejected ? '✕ Rejected' : 'Reject as weak'}
        </button>
      </div>

      {message ? (
        <p className={`text-[11px] ${isError ? 'text-occupied' : 'text-ink-muted'}`}>{message}</p>
      ) : null}
    </div>
  );
}
