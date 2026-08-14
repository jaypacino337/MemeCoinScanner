import type { ReactNode } from 'react';
import { formatCount, formatDate } from '@/lib/format';

/**
 * Seven-day growth chart.
 *
 * Plots only the snapshots that exist — no interpolation between distant
 * observations and no smoothing, so a gap in coverage is visible as a gap
 * rather than being disguised as a smooth trend. Points are marked so the
 * reader can see how much real data backs the line.
 */

export interface GrowthPoint {
  capturedAt: Date | string;
  views: number | null;
  likes: number | null;
}

const WIDTH = 640;
const HEIGHT = 180;
const PADDING = { top: 12, right: 12, bottom: 24, left: 48 };

export function GrowthChart({ points }: { points: GrowthPoint[] }): ReactNode {
  const usable = points
    .map((p) => ({
      time: new Date(p.capturedAt).getTime(),
      views: p.views,
      likes: p.likes,
    }))
    .filter((p) => Number.isFinite(p.time) && p.views !== null)
    .sort((a, b) => a.time - b.time);

  if (usable.length < 2) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded border border-dashed border-hairline-strong bg-panel/40 px-4 text-center">
        <p className="text-xs text-ink-muted">
          {usable.length === 0
            ? 'No metric snapshots stored for this post yet.'
            : 'Only one snapshot stored — a growth curve needs at least two observations.'}
        </p>
      </div>
    );
  }

  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  const minTime = first.time;
  const maxTime = last.time;
  const timeSpan = Math.max(maxTime - minTime, 1);

  const viewValues = usable.map((p) => p.views ?? 0);
  const maxViews = Math.max(...viewValues, 1);
  const minViews = Math.min(...viewValues, 0);
  const viewSpan = Math.max(maxViews - minViews, 1);

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (time: number): number => PADDING.left + ((time - minTime) / timeSpan) * plotWidth;
  const y = (value: number): number =>
    PADDING.top + plotHeight - ((value - minViews) / viewSpan) * plotHeight;

  const linePath = usable
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.time).toFixed(2)} ${y(p.views ?? 0).toFixed(2)}`)
    .join(' ');

  const areaPath = `${linePath} L ${x(last.time).toFixed(2)} ${(PADDING.top + plotHeight).toFixed(
    2,
  )} L ${x(first.time).toFixed(2)} ${(PADDING.top + plotHeight).toFixed(2)} Z`;

  const gridValues = [minViews, minViews + viewSpan / 2, maxViews];

  return (
    <figure className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[420px]"
        role="img"
        aria-label={`View growth from ${formatCount(first.views)} to ${formatCount(last.views)} across ${usable.length} snapshots`}
      >
        <defs>
          <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((value, i) => (
          <g key={i}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-hairline)"
              strokeWidth="1"
            />
            <text
              x={PADDING.left - 8}
              y={y(value) + 3.5}
              textAnchor="end"
              className="fill-[var(--color-ink-faint)] text-[10px]"
            >
              {formatCount(value)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#growthFill)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {usable.map((p, i) => (
          <circle
            key={i}
            cx={x(p.time)}
            cy={y(p.views ?? 0)}
            r="3"
            fill="var(--color-void)"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
          >
            <title>
              {formatDate(new Date(p.time))} — {formatCount(p.views)} views
            </title>
          </circle>
        ))}

        <text
          x={PADDING.left}
          y={HEIGHT - 6}
          className="fill-[var(--color-ink-faint)] text-[10px]"
        >
          {formatDate(new Date(minTime))}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-[var(--color-ink-faint)] text-[10px]"
        >
          {formatDate(new Date(maxTime))}
        </text>
      </svg>
      <figcaption className="mt-2 text-[11px] text-ink-faint">
        {usable.length} stored snapshot{usable.length === 1 ? '' : 's'}. Points are actual
        observations; the line connects them without smoothing or interpolation.
      </figcaption>
    </figure>
  );
}
