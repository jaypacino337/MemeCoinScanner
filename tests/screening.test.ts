import { describe, expect, it } from 'vitest';
import type { IndexedToken, TokenIndexResponse } from '@/lib/domain/types';
import {
  classifyToken,
  DUST_MARKET_CAP_USD,
  screenConcept,
  screenWithAlternates,
} from '@/lib/pipeline/screening';

const NOW = new Date('2026-08-14T12:00:00Z');

function token(overrides: Partial<IndexedToken> = {}): IndexedToken {
  return {
    mintAddress: 'Mint1',
    name: 'Some Token',
    ticker: 'SOME',
    url: null,
    marketCapUsd: 500_000,
    athMarketCapUsd: 900_000,
    createdAt: new Date(NOW.getTime() - 3 * 86_400_000),
    holders: 1000,
    linkedPostUrl: null,
    subjectTags: [],
    source: 'OFFICIAL_API',
    confidence: 'HIGH',
    ...overrides,
  };
}

function response(tokens: IndexedToken[], complete = true, note?: string): TokenIndexResponse {
  return {
    queries: ['ticker:FERRET', 'name:Commuter Ferret', 'subject:commuter ferret'],
    tokens,
    searchedAt: NOW,
    complete,
    note,
  };
}

describe('classifyToken', () => {
  it('calls a well-capitalised token genuine', () => {
    expect(classifyToken(token({ marketCapUsd: 800_000 }), NOW)).toBe('GENUINE');
  });

  it('calls a collapsed former-runner abandoned', () => {
    const result = classifyToken(
      token({
        marketCapUsd: 900,
        athMarketCapUsd: 1_400_000,
        createdAt: new Date(NOW.getTime() - 40 * 86_400_000),
      }),
      NOW,
    );
    expect(result).toBe('ABANDONED');
  });

  it('calls a tiny launch a dust launch', () => {
    expect(
      classifyToken(token({ marketCapUsd: 900, athMarketCapUsd: 2_000 }), NOW),
    ).toBe('DUST_LAUNCH');
    expect(DUST_MARKET_CAP_USD).toBeGreaterThan(900);
  });

  it('returns UNKNOWN when the index gives no market data', () => {
    expect(
      classifyToken(token({ marketCapUsd: null, athMarketCapUsd: null }), NOW),
    ).toBe('UNKNOWN');
  });
});

describe('screenConcept', () => {
  const base = {
    name: 'Commuter Ferret',
    ticker: 'FERRET',
    subject: 'commuter ferret',
    now: NOW,
  };

  it('returns CLEAN when nothing matches', () => {
    const report = screenConcept({ ...base, response: response([token({ ticker: 'ZZZZ', name: 'Unrelated' })]) });

    expect(report.status).toBe('CLEAN');
    expect(report.matches).toHaveLength(0);
  });

  it('never claims the concept has never existed', () => {
    const report = screenConcept({ ...base, response: response([]) });

    expect(report.status).toBe('CLEAN');
    expect(report.statement).toMatch(/not a claim that no such token has ever existed/i);
    // The statement must say what was searched and when.
    expect(report.statement).toContain('ticker:FERRET');
    expect(report.statement).toContain(NOW.toISOString());
  });

  it('detects an exact ticker match', () => {
    const report = screenConcept({
      ...base,
      response: response([token({ ticker: 'FERRET', name: 'Something Else' })]),
    });

    expect(report.matches[0]?.matchType).toBe('EXACT_TICKER');
    expect(report.status).toBe('OCCUPIED');
  });

  it('detects an exact name match under a different ticker', () => {
    const report = screenConcept({
      ...base,
      response: response([token({ ticker: 'CMTR', name: 'Commuter Ferret' })]),
    });

    expect(report.matches[0]?.matchType).toBe('EXACT_NAME');
  });

  it('detects close spelling variants', () => {
    const report = screenConcept({
      ...base,
      response: response([token({ ticker: 'FERRETS', name: 'Ferrets' })]),
    });

    expect(report.matches[0]?.matchType).toBe('SPELLING_VARIANT');
  });

  it('detects the same subject launched under an unrelated ticker', () => {
    const report = screenConcept({
      ...base,
      response: response([
        token({ ticker: 'TRAINY', name: 'Train Weasel', subjectTags: ['commuter ferret'] }),
      ]),
    });

    expect(report.matches[0]?.matchType).toBe('SAME_SUBJECT');
    expect(report.status).toBe('OCCUPIED');
  });

  it('detects a token that links back to the same source post', () => {
    const postUrl = 'https://www.tiktok.com/@demo_user/video/7411';
    const report = screenConcept({
      ...base,
      postUrl,
      response: response([
        token({ ticker: 'OTHER', name: 'Other', linkedPostUrl: postUrl }),
      ]),
    });

    expect(report.matches[0]?.matchType).toBe('LINKED_POST');
  });

  it('returns DUST_ONLY when every match is a dust launch', () => {
    const report = screenConcept({
      ...base,
      response: response([
        token({ ticker: 'FERRET', marketCapUsd: 800, athMarketCapUsd: 1_500 }),
      ]),
    });

    expect(report.status).toBe('DUST_ONLY');
    expect(report.statement).toMatch(/none showing meaningful traction/i);
  });

  it('returns UNCERTAIN when the index could not complete the search', () => {
    const report = screenConcept({
      ...base,
      response: response([], false, 'upstream timeout'),
    });

    expect(report.status).toBe('UNCERTAIN');
    expect(report.statement).toMatch(/could not be established either way/i);
    expect(report.statement).toContain('upstream timeout');
  });

  it('returns UNCERTAIN when matches exist but market data is missing', () => {
    const report = screenConcept({
      ...base,
      response: response([
        token({ ticker: 'FERRET', marketCapUsd: null, athMarketCapUsd: null }),
      ]),
    });

    expect(report.status).toBe('UNCERTAIN');
  });

  it('treats an abandoned former-runner as OCCUPIED', () => {
    const report = screenConcept({
      ...base,
      response: response([
        token({
          ticker: 'FERRET',
          marketCapUsd: 500,
          athMarketCapUsd: 2_000_000,
          createdAt: new Date(NOW.getTime() - 60 * 86_400_000),
        }),
      ]),
    });

    expect(report.status).toBe('OCCUPIED');
  });

  it('matches subject aliases supplied by the provider', () => {
    const report = screenConcept({
      ...base,
      subjectAliases: ['briefcase ferret'],
      response: response([
        token({ ticker: 'BRIEF', name: 'Brief', subjectTags: ['briefcase ferret'] }),
      ]),
    });

    expect(report.matches[0]?.matchType).toBe('SAME_SUBJECT');
  });

  it('echoes the exact queries that were issued', () => {
    const report = screenConcept({ ...base, response: response([]) });
    expect(report.queries).toEqual([
      'ticker:FERRET',
      'name:Commuter Ferret',
      'subject:commuter ferret',
    ]);
  });
});

describe('screenWithAlternates', () => {
  it('promotes the first clean alternate when the primary is occupied', async () => {
    const lookup = async (query: { ticker: string }): Promise<TokenIndexResponse> => {
      if (query.ticker === 'FERRET') {
        return response([token({ ticker: 'FERRET', marketCapUsd: 900_000 })]);
      }
      return response([]);
    };

    const result = await screenWithAlternates(
      { name: 'Commuter Ferret', ticker: 'FERRET' },
      [
        { name: 'Commuter Ferret', ticker: 'CMTRFRT' },
        { name: 'Commuter Ferret', ticker: 'BRIEFCAT' },
      ],
      'commuter ferret',
      lookup,
      { now: NOW },
    );

    expect(result.reports.get('FERRET')?.status).toBe('OCCUPIED');
    expect(result.recommendedTicker).toBe('CMTRFRT');
    expect(result.recommendedStatus).toBe('CLEAN');
  });

  it('keeps the primary when it screens clean, but still screens alternates', async () => {
    const lookup = async (): Promise<TokenIndexResponse> => response([]);

    const result = await screenWithAlternates(
      { name: 'Commuter Ferret', ticker: 'FERRET' },
      [{ name: 'Alt', ticker: 'CMTRFRT' }],
      'commuter ferret',
      lookup,
      { now: NOW },
    );

    expect(result.recommendedTicker).toBe('FERRET');
    // Alternates are screened regardless so the detail page can display them.
    expect(result.reports.has('CMTRFRT')).toBe(true);
  });

  it('does not promote an alternate that is itself occupied', async () => {
    const lookup = async (query: { ticker: string }): Promise<TokenIndexResponse> =>
      response([token({ ticker: query.ticker, marketCapUsd: 900_000 })]);

    const result = await screenWithAlternates(
      { name: 'Commuter Ferret', ticker: 'FERRET' },
      [{ name: 'Alt', ticker: 'CMTRFRT' }],
      'commuter ferret',
      lookup,
      { now: NOW },
    );

    expect(result.recommendedTicker).toBe('FERRET');
    expect(result.recommendedStatus).toBe('OCCUPIED');
  });
});
