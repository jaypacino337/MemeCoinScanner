/**
 * Daily runner scan: `npm run runners:daily` (add `-- --date 2026-10-04` to label a day).
 *
 * 1. Pulls today's runners from pump.fun + DexScreener.
 * 2. Classifies them into metas and grades every site in data/sites.json.
 * 3. Updates the rolling memory (data/runner-memory/memory.json) so trends and
 *    grade changes accumulate day over day.
 * 4. Writes the day's snapshot + a markdown brief under reports/runners/.
 *
 * Re-running on the same date replaces that day; it never double counts.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchRunners } from '../src/lib/runners/feed';
import { renderReportMarkdown } from '../src/lib/runners/markdown';
import { buildDailyReport, EMPTY_MEMORY, type RunnerMemory, type SiteEntry } from '../src/lib/runners/report';

const ROOT = join(__dirname, '..');
const SITES = join(ROOT, 'data', 'sites.json');
const MEMORY_DIR = join(ROOT, 'data', 'runner-memory');
const MEMORY = join(MEMORY_DIR, 'memory.json');
const REPORTS = join(ROOT, 'reports', 'runners');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const now = new Date();
  const date = arg('date') ?? now.toISOString().slice(0, 10);

  const sites = JSON.parse(readFileSync(SITES, 'utf8')) as SiteEntry[];
  const memory: RunnerMemory = existsSync(MEMORY)
    ? (JSON.parse(readFileSync(MEMORY, 'utf8')) as RunnerMemory)
    : EMPTY_MEMORY;

  console.error(`fetching runners for ${date}…`);
  const feed = await fetchRunners({ now });
  if (feed.runners.length === 0) {
    throw new Error(`No runners returned (sources: ${JSON.stringify(feed.sourceStatus)}). Memory left untouched.`);
  }

  const { report, memory: nextMemory } = buildDailyReport({
    date,
    now,
    runners: feed.runners,
    sites,
    memory,
    sourceStatus: { ...feed.sourceStatus, candidatesSeen: String(feed.candidatesSeen) },
  });

  mkdirSync(join(MEMORY_DIR, 'days'), { recursive: true });
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(MEMORY, `${JSON.stringify(nextMemory, null, 1)}\n`);
  writeFileSync(join(MEMORY_DIR, 'days', `${date}.json`), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(MEMORY_DIR, 'latest.json'), `${JSON.stringify(report, null, 1)}\n`);
  const md = renderReportMarkdown(report);
  writeFileSync(join(REPORTS, `${date}.md`), md);
  writeFileSync(join(REPORTS, 'LATEST.md'), md);

  console.log(`${report.runnerCount} runners · ${report.sites.length} sites graded · memory ${report.memoryDays} day(s)`);
  console.log(`hottest: ${report.metaBoard.slice(0, 3).map((m) => `${m.label} ${Math.round(m.share * 100)}%`).join(' | ')}`);
  console.log(`top: ${report.top.join(', ')}`);
  console.log(`bottom: ${report.bottom.join(', ')}`);
  console.log(`wrote reports/runners/${date}.md`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
