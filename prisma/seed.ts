/**
 * Seeds the database by running a scan against whichever providers are
 * configured. In the default fixture mode this loads the bundled synthetic
 * demo data — every row it writes is tagged SYNTHETIC_FIXTURE / UNVERIFIED.
 */
import { DEFAULT_FILTERS } from '../src/lib/domain/types';
import { prisma } from '../src/server/db';
import { executeScan } from '../src/server/scan-service';

async function main(): Promise<void> {
  console.log('Seeding — running a scan with the configured providers…');

  // A wide window and no view floor so the demo set lands in full; the UI
  // filters are what narrow it afterwards.
  const { scanRunId, result, fixtureMode } = await executeScan(
    {
      ...DEFAULT_FILTERS,
      windowDays: 90,
      minViews: 0,
      requireEnglishAudience: false,
    },
    'seed',
  );

  console.log(`Scan ${scanRunId} finished.`);
  console.log(`  mode:      ${fixtureMode ? 'FIXTURE (synthetic demo data)' : 'live providers'}`);
  console.log(`  seen:      ${result.stats.postsSeen}`);
  console.log(`  accepted:  ${result.stats.postsAccepted}`);
  console.log(`  filtered:  ${result.stats.postsRejected}`);
  if (result.errors.length > 0) {
    console.log(`  errors:    ${result.errors.map((e) => `${e.platform}: ${e.message}`).join(' | ')}`);
  }

  const byStatus = await prisma.tokenConcept.groupBy({
    by: ['screeningStatus'],
    where: { isPrimary: true },
    _count: { _all: true },
  });
  console.log('  primary concept screening:');
  for (const row of byStatus) {
    console.log(`    ${row.screeningStatus}: ${row._count._all}`);
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
