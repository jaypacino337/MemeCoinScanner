import type { IndexedToken } from '@/lib/domain/types';

/**
 * SYNTHETIC token-index fixtures.
 *
 * These stand in for a Pump.fun-style index so the duplicate screener can be
 * exercised without live access. None of these are real tokens and none of the
 * market caps are real measurements — every record is tagged SYNTHETIC_FIXTURE
 * and surfaces in the UI as demo data.
 *
 * The set is arranged to produce all four screening statuses across the demo
 * candidates: an established collision, a dust-only collision, a same-subject
 * collision under a different ticker, and plenty of clean space.
 */

const MS_PER_DAY = 86_400_000;

export interface TokenFixtureSeed {
  mintAddress: string;
  name: string;
  ticker: string;
  marketCapUsd: number | null;
  athMarketCapUsd: number | null;
  createdDaysAgo: number | null;
  holders: number | null;
  subjectTags: string[];
  linkedPostUrl?: string;
}

export const TOKEN_FIXTURE_SEEDS: TokenFixtureSeed[] = [
  // --- Established: should drive OCCUPIED for the "cabinet cat" subject ---
  {
    mintAddress: 'DemoMint1111111111111111111111111111111111',
    name: 'Cabinet Cat',
    ticker: 'CABCAT',
    marketCapUsd: 1_840_000,
    athMarketCapUsd: 4_200_000,
    createdDaysAgo: 5,
    holders: 7_400,
    subjectTags: ['cabinetcat', 'cabinet cat', 'cupboard cat'],
  },
  // Same subject, different ticker — catches SAME_SUBJECT matching.
  {
    mintAddress: 'DemoMint2222222222222222222222222222222222',
    name: 'Cupboard Kitty',
    ticker: 'CUPKIT',
    marketCapUsd: 240_000,
    athMarketCapUsd: 610_000,
    createdDaysAgo: 4,
    holders: 1_900,
    subjectTags: ['cabinet cat', 'cabinetcat'],
  },
  // --- Established collision on a raccoon subject ---
  {
    mintAddress: 'DemoMint3333333333333333333333333333333333',
    name: 'Climbing Raccoon',
    ticker: 'CLIMB',
    marketCapUsd: 890_000,
    athMarketCapUsd: 2_100_000,
    createdDaysAgo: 2,
    holders: 5_100,
    subjectTags: ['climbing raccoon', 'trash panda climber'],
  },
  // --- Dust launches: exist, but no traction -> DUST_ONLY ---
  {
    mintAddress: 'DemoMint4444444444444444444444444444444444',
    name: 'Weather Goat',
    ticker: 'WEATHER',
    marketCapUsd: 3_100,
    athMarketCapUsd: 8_900,
    createdDaysAgo: 1,
    holders: 22,
    subjectTags: ['weather goat'],
  },
  {
    mintAddress: 'DemoMint5555555555555555555555555555555555',
    name: 'Goat Forecast',
    ticker: 'GOATFC',
    marketCapUsd: 640,
    athMarketCapUsd: 1_200,
    createdDaysAgo: 1,
    holders: 6,
    subjectTags: ['weather goat'],
  },
  {
    mintAddress: 'DemoMint6666666666666666666666666666666666',
    name: 'Squat Rack Goose',
    ticker: 'SQUAT',
    marketCapUsd: 5_400,
    athMarketCapUsd: 11_000,
    createdDaysAgo: 3,
    holders: 41,
    subjectTags: ['squat rack goose'],
  },
  // --- Abandoned: had real traction, now dead -> still OCCUPIED ---
  {
    mintAddress: 'DemoMint7777777777777777777777777777777777',
    name: 'Bus Stop Pigeon',
    ticker: 'PIGEON',
    marketCapUsd: 4_200,
    athMarketCapUsd: 1_400_000,
    createdDaysAgo: 40,
    holders: 310,
    subjectTags: ['bus stop pigeon', 'pigeon'],
  },
  // --- Unrelated noise so searches return realistic mixed results ---
  {
    mintAddress: 'DemoMint8888888888888888888888888888888888',
    name: 'Desk Gremlin',
    ticker: 'GREM',
    marketCapUsd: 1_100,
    athMarketCapUsd: 2_400,
    createdDaysAgo: 12,
    holders: 14,
    subjectTags: ['gremlin'],
  },
  {
    mintAddress: 'DemoMint9999999999999999999999999999999999',
    name: 'Soup Drink Theory',
    ticker: 'SOUP',
    marketCapUsd: 62_000,
    athMarketCapUsd: 74_000,
    createdDaysAgo: 6,
    holders: 820,
    subjectTags: ['soup is a drink', 'soup'],
  },
  {
    mintAddress: 'DemoMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'Tube Man',
    ticker: 'TUBE',
    marketCapUsd: 18_000,
    athMarketCapUsd: 320_000,
    createdDaysAgo: 120,
    holders: 460,
    subjectTags: ['inflatable tube man salute', 'tube man'],
  },
  {
    mintAddress: 'DemoMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    name: 'Heron',
    ticker: 'HERON',
    marketCapUsd: null,
    athMarketCapUsd: null,
    createdDaysAgo: 9,
    holders: null,
    subjectTags: ['heron'],
  },
];

export function buildTokenFixtures(now: Date): IndexedToken[] {
  return TOKEN_FIXTURE_SEEDS.map((seed) => ({
    mintAddress: seed.mintAddress,
    name: seed.name,
    ticker: seed.ticker,
    url: `https://pump.fun/coin/${seed.mintAddress}`,
    marketCapUsd: seed.marketCapUsd,
    athMarketCapUsd: seed.athMarketCapUsd,
    createdAt:
      seed.createdDaysAgo === null
        ? null
        : new Date(now.getTime() - seed.createdDaysAgo * MS_PER_DAY),
    holders: seed.holders,
    linkedPostUrl: seed.linkedPostUrl ?? null,
    subjectTags: seed.subjectTags,
    source: 'SYNTHETIC_FIXTURE' as const,
    confidence: 'UNVERIFIED' as const,
  }));
}
