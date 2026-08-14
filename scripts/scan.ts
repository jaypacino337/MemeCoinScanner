/**
 * CLI scan runner: `npm run scan -- --platform TIKTOK --min-views 1000000`
 *
 * Useful for local ingestion without standing up the scheduler.
 */
import { DEFAULT_FILTERS, PLATFORMS, type Platform } from '../src/lib/domain/types';
import { prisma } from '../src/server/db';
import { executeScan } from '../src/server/scan-service';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const platformArg = args.platform?.toUpperCase();
  const platforms: Platform[] =
    platformArg && (PLATFORMS as readonly string[]).includes(platformArg)
      ? [platformArg as Platform]
      : [...PLATFORMS];

  const filters = {
    ...DEFAULT_FILTERS,
    platforms,
    windowDays: args['window-days'] ? Number(args['window-days']) : DEFAULT_FILTERS.windowDays,
    minViews: args['min-views'] ? Number(args['min-views']) : DEFAULT_FILTERS.minViews,
    requireEnglishAudience: args['no-english'] !== 'true',
  };

  const { scanRunId, result, fixtureMode } = await executeScan(filters, 'cli');

  console.log(`scan ${scanRunId} (${fixtureMode ? 'fixture' : 'live'} mode)`);
  console.log(`  seen ${result.stats.postsSeen} · accepted ${result.stats.postsAccepted} · filtered ${result.stats.postsRejected}`);
  for (const [platform, tally] of Object.entries(result.stats.perPlatform)) {
    console.log(`    ${platform}: ${tally.accepted}/${tally.seen}`);
  }
  for (const error of result.errors) {
    console.error(`  error ${error.platform}: ${error.message}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
