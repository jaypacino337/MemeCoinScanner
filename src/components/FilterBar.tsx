'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { CONTENT_CATEGORIES } from '@/lib/domain/types';
import { titleCase } from '@/lib/format';
import type { FilterState } from '@/lib/filter-state';

/**
 * Discovery filter controls.
 *
 * State lives in the URL so a filtered view is shareable and survives a reload,
 * and so the server components can read it directly without a client store.
 */

const WINDOW_OPTIONS = [
  { value: 7, label: '7 days (primary)' },
  { value: 14, label: '14 days (early signal)' },
  { value: 90, label: '90 days (rediscovery)' },
];

const VIEW_OPTIONS = [
  { value: 0, label: 'Any' },
  { value: 500_000, label: '500K+' },
  { value: 1_000_000, label: '1M+' },
  { value: 3_000_000, label: '3M+ (default)' },
  { value: 10_000_000, label: '10M+' },
  { value: 25_000_000, label: '25M+' },
];

export function FilterBar({ filters }: { filters: FilterState }): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (key: string, value: string | number | boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      const stringValue = String(value);
      // Keep the URL clean: only non-default values are written.
      if (stringValue === '' || stringValue === 'false') params.delete(key);
      else params.set(key, stringValue);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const reset = useCallback(() => router.push(pathname), [pathname, router]);

  return (
    <details
      className="rounded-lg border border-hairline bg-charcoal"
      open={searchParams.size > 0}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold tracking-wide text-ink uppercase select-none">
        Filters
        <span className="ml-2 font-normal text-ink-faint normal-case">
          {searchParams.size > 0 ? `${searchParams.size} active` : 'defaults'}
        </span>
      </summary>

      <div className="grid gap-4 border-t border-hairline p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date range">
          <Select
            value={String(filters.windowDays)}
            onChange={(v) => update('windowDays', v)}
            options={WINDOW_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          />
        </Field>

        <Field label="Minimum views">
          <Select
            value={String(filters.minViews)}
            onChange={(v) => update('minViews', v)}
            options={VIEW_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          />
        </Field>

        <Field label="Minimum likes">
          <NumberInput value={filters.minLikes} onChange={(v) => update('minLikes', v)} />
        </Field>

        <Field label="Minimum followers">
          <NumberInput value={filters.minFollowers} onChange={(v) => update('minFollowers', v)} />
        </Field>

        <Field label="Content category">
          <Select
            value={filters.category}
            onChange={(v) => update('category', v)}
            options={[
              { value: '', label: 'All categories' },
              ...CONTENT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) })),
            ]}
          />
        </Field>

        <Field label="Screening status">
          <Select
            value={filters.screeningStatus}
            onChange={(v) => update('screeningStatus', v)}
            options={[
              { value: '', label: 'Any status' },
              { value: 'CLEAN', label: 'Clean only' },
              { value: 'DUST_ONLY', label: 'Dust only' },
              { value: 'UNCERTAIN', label: 'Uncertain' },
              { value: 'OCCUPIED', label: 'Occupied' },
            ]}
          />
        </Field>

        <Field label="Signal stage">
          <Select
            value={filters.signalStage}
            onChange={(v) => update('stage', v)}
            options={[
              { value: 'any', label: 'Any stage' },
              { value: 'early', label: 'Early signal' },
              { value: 'giga', label: 'Already giga-viral' },
            ]}
          />
        </Field>

        <div className="sm:col-span-2 lg:col-span-4">
          <p className="mb-2 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
            Toggles
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle
              label="English audience"
              checked={filters.requireEnglishAudience}
              onChange={(v) => update('english', v)}
            />
            <Toggle
              label="Animals only"
              checked={filters.animalsOnly}
              onChange={(v) => update('animalsOnly', v)}
            />
            <Toggle
              label="Cats & dogs only"
              checked={filters.catsAndDogsOnly}
              onChange={(v) => update('catsAndDogsOnly', v)}
            />
            <Toggle
              label="PFP-friendly only"
              checked={filters.pfpFriendlyOnly}
              onChange={(v) => update('pfpOnly', v)}
            />
            <Toggle
              label="No celebrity/IP risk"
              checked={filters.noCelebrityOrIpRisk}
              onChange={(v) => update('noIpRisk', v)}
            />
            <Toggle
              label="No existing Pump.fun match"
              checked={filters.requireCleanPumpFun}
              onChange={(v) => update('cleanOnly', v)}
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-4">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-hairline-strong px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}): ReactNode {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-hairline-strong bg-panel px-2 py-1.5 text-xs text-ink"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}): ReactNode {
  return (
    <input
      type="number"
      min={0}
      step={1000}
      defaultValue={value}
      onBlur={(e) => onChange(Number(e.target.value) || 0)}
      className="w-full rounded border border-hairline-strong bg-panel px-2 py-1.5 font-mono text-xs text-ink tnum"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): ReactNode {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-hairline-strong bg-panel accent-accent"
      />
      {label}
    </label>
  );
}
