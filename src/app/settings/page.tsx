import type { ReactNode } from 'react';
import { ErrorState, Panel, StatTile } from '@/components/primitives';
import { ScanButton } from '@/components/ScanButton';
import { credentialStatus, getEnv } from '@/env';
import { DEFAULT_FILTERS } from '@/lib/domain/types';
import { PENALTIES, SCORE_WEIGHTS } from '@/lib/pipeline/scoring';
import { formatDate, titleCase } from '@/lib/format';
import { prisma } from '@/server/db';
import { getHealthSnapshot } from '@/server/scan-service';

export const dynamic = 'force-dynamic';

const STATE_TONE: Record<string, string> = {
  HEALTHY: 'text-clean border-clean/40 bg-clean/10',
  DEGRADED: 'text-caution border-caution/40 bg-caution/10',
  RATE_LIMITED: 'text-caution border-caution/40 bg-caution/10',
  CREDENTIALS_MISSING: 'text-caution border-caution/40 bg-caution/10',
  DOWN: 'text-occupied border-occupied/40 bg-occupied/10',
};

export default async function SettingsPage(): Promise<ReactNode> {
  const env = getEnv();
  const credentials = credentialStatus();

  let sources: Awaited<ReturnType<typeof getHealthSnapshot>> = [];
  let jobStats: Record<string, number> = {};
  let lastScans: Array<{
    id: string;
    trigger: string;
    status: string;
    startedAt: Date;
    postsSeen: number;
    postsAccepted: number;
    postsRejected: number;
    errorCount: number;
  }> = [];
  let loadError: string | null = null;

  try {
    sources = await getHealthSnapshot();
    const grouped = await prisma.job.groupBy({ by: ['status'], _count: { _all: true } });
    jobStats = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
    lastScans = await prisma.scanRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        trigger: true,
        status: true,
        startedAt: true,
        postsSeen: true,
        postsAccepted: true,
        postsRejected: true,
        errorCount: true,
      },
    });
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unknown error';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">
            Settings &amp; data-source health
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            What is connected, what is running on fixtures, and exactly which credential each
            integration needs.
          </p>
        </div>
        <ScanButton label="Run scan now" />
      </header>

      {loadError ? (
        <ErrorState title="Could not read health data from the database" detail={loadError} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Data mode"
          value={env.DATA_MODE === 'live' ? 'Live' : 'Fixture'}
          hint={
            env.DATA_MODE === 'live'
              ? 'HTTP adapters used where credentials exist'
              : 'All providers serve labelled demo data'
          }
          tone={env.DATA_MODE === 'live' ? 'good' : 'warn'}
        />
        <StatTile
          label="Link verification"
          value={env.ENABLE_LINK_VERIFICATION ? 'Enabled' : 'Disabled'}
          hint={
            env.ENABLE_LINK_VERIFICATION
              ? 'URLs are resolved before display'
              : 'Structural checks only'
          }
          tone={env.ENABLE_LINK_VERIFICATION ? 'good' : 'warn'}
        />
        <StatTile
          label="Queued jobs"
          value={String(jobStats.QUEUED ?? 0)}
          hint={`${jobStats.DEAD ?? 0} dead · ${jobStats.SUCCEEDED ?? 0} succeeded`}
          tone={(jobStats.DEAD ?? 0) > 0 ? 'bad' : 'default'}
        />
        <StatTile
          label="Rate limit"
          value={`${env.RATE_LIMIT_PER_MINUTE}/min`}
          hint="Per client, per API route"
        />
      </div>

      <Panel
        title="Data sources"
        subtitle="Live state per provider, plus the credential required to move it off fixtures"
      >
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source.sourceKey}
              className="flex flex-col gap-2 rounded border border-hairline bg-panel p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">
                    {source.sourceKey}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase ${
                      STATE_TONE[source.state] ?? 'text-ink-faint border-hairline-strong'
                    }`}
                  >
                    {source.state.replace(/_/g, ' ')}
                  </span>
                  <span className="rounded border border-hairline-strong px-1.5 py-0.5 text-[10px] text-ink-faint">
                    {source.mode}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{source.detail}</p>
                {source.requiresCredential ? (
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">
                    Requires: {source.requiresCredential}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-[11px] text-ink-faint">
                <p>Last success: {source.lastSuccessAt ? formatDate(source.lastSuccessAt) : '—'}</p>
                <p>Last failure: {source.lastFailureAt ? formatDate(source.lastFailureAt) : '—'}</p>
                {source.consecutiveFailures > 0 ? (
                  <p className="text-occupied">
                    {source.consecutiveFailures} consecutive failure(s)
                  </p>
                ) : null}
              </div>
            </div>
          ))}
          {sources.length === 0 && !loadError ? (
            <p className="text-sm text-ink-muted">No providers registered.</p>
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Credentials detected">
          <ul className="space-y-2">
            {Object.entries(credentials).map(([key, present]) => (
              <li key={key} className="flex items-center justify-between text-sm">
                <span className="font-mono text-ink-muted">{key}</span>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase ${
                    present
                      ? 'border-clean/40 bg-clean/10 text-clean'
                      : 'border-caution/40 bg-caution/10 text-caution'
                  }`}
                >
                  {present ? 'configured' : 'missing'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
            No credential is fabricated or assumed. When one is missing the matching adapter serves
            labelled fixtures and says so, rather than presenting synthetic numbers as live
            measurements. See docs/DATA_SOURCES.md for what each integration requires.
          </p>
        </Panel>

        <Panel title="Recent scans">
          {lastScans.length === 0 ? (
            <p className="text-sm text-ink-muted">No scans recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead>
                  <tr className="border-b border-hairline text-[10px] tracking-wider text-ink-faint uppercase">
                    <th className="py-1.5 pr-3 font-medium">Started</th>
                    <th className="py-1.5 pr-3 font-medium">Trigger</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Seen</th>
                    <th className="py-1.5 pr-3 font-medium">Kept</th>
                    <th className="py-1.5 font-medium">Filtered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {lastScans.map((scan) => (
                    <tr key={scan.id}>
                      <td className="py-1.5 pr-3 text-ink-muted">{formatDate(scan.startedAt)}</td>
                      <td className="py-1.5 pr-3 text-ink-muted">{scan.trigger}</td>
                      <td
                        className={`py-1.5 pr-3 ${
                          scan.status === 'SUCCEEDED'
                            ? 'text-clean'
                            : scan.status === 'FAILED'
                              ? 'text-occupied'
                              : 'text-caution'
                        }`}
                      >
                        {titleCase(scan.status)}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-ink tnum">{scan.postsSeen}</td>
                      <td className="py-1.5 pr-3 font-mono text-clean tnum">
                        {scan.postsAccepted}
                      </td>
                      <td className="py-1.5 font-mono text-ink-muted tnum">{scan.postsRejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Scoring model" subtitle="The weights actually used to rank">
          <ul className="space-y-1.5 text-sm">
            {Object.entries(SCORE_WEIGHTS).map(([key, weight]) => (
              <li key={key} className="flex justify-between">
                <span className="text-ink-muted">{titleCase(key)}</span>
                <span className="font-mono text-ink tnum">{weight}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 mb-2 border-t border-hairline pt-3 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
            Penalties
          </h3>
          <ul className="space-y-1.5 text-sm">
            {Object.entries(PENALTIES).map(([key, points]) => (
              <li key={key} className="flex justify-between">
                <span className="text-ink-muted">{titleCase(key)}</span>
                <span className="font-mono text-occupied tnum">−{points}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Default discovery settings">
          <ul className="space-y-1.5 text-sm">
            <Row label="Primary window">{DEFAULT_FILTERS.windowDays} days</Row>
            <Row label="Minimum views">{DEFAULT_FILTERS.minViews.toLocaleString()}</Row>
            <Row label="English audience required">
              {DEFAULT_FILTERS.requireEnglishAudience ? 'Yes' : 'No'}
            </Row>
            <Row label="Results per feed">{DEFAULT_FILTERS.limit}</Row>
            <Row label="Cache TTL">{env.CACHE_TTL_SECONDS}s</Row>
            <Row label="HTTP timeout">{env.HTTP_TIMEOUT_MS}ms</Row>
            <Row label="Log level">{env.LOG_LEVEL}</Row>
          </ul>
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
            Scheduled ingestion is driven by <code>POST /api/cron/scan</code> and{' '}
            <code>POST /api/cron/worker</code>, both authenticated with <code>CRON_SECRET</code>.
            Point any scheduler at them; see the README for a sample crontab and vercel.json.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <li className="flex justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="font-mono text-ink tnum">{children}</span>
    </li>
  );
}
