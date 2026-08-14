import { describe, expect, it } from 'vitest';
import {
  buildSuggestions,
  generateTickerCandidates,
  generateTokenName,
  MAX_TICKER_LENGTH,
  normalizeTicker,
  spellingVariants,
  validateTicker,
} from '@/lib/pipeline/ticker';

describe('normalizeTicker', () => {
  it('uppercases, strips punctuation, and caps the length', () => {
    expect(normalizeTicker('weather-goat!')).toBe('WEATHERGOA');
    expect(normalizeTicker('a b c')).toBe('ABC');
    expect(normalizeTicker('cabinet cat').length).toBeLessThanOrEqual(MAX_TICKER_LENGTH);
  });

  it('strips diacritics rather than dropping the letters', () => {
    expect(normalizeTicker('élan')).toBe('ELAN');
  });
});

describe('validateTicker', () => {
  it('accepts a short, pronounceable, subject-derived ticker', () => {
    expect(validateTicker('FERRET', 'commuter ferret').valid).toBe(true);
  });

  it('rejects tickers longer than ten characters', () => {
    const result = validateTicker('ABCDEFGHIJKL');
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toMatch(/Longer than 10/);
  });

  it('rejects punctuation and confusing characters', () => {
    expect(validateTicker('CAT-DOG').valid).toBe(false);
    expect(validateTicker('CA$H').valid).toBe(false);
  });

  it('rejects unpronounceable consonant runs', () => {
    const result = validateTicker('XKCDPRT');
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toMatch(/pronounce/i);
  });

  it('accepts short acronyms even without vowels', () => {
    expect(validateTicker('BTC').valid).toBe(true);
  });

  it('rejects generic filler words', () => {
    expect(validateTicker('COIN').valid).toBe(false);
    expect(validateTicker('MEME').valid).toBe(false);
  });

  it('rejects digits-only tickers', () => {
    expect(validateTicker('12345').valid).toBe(false);
  });

  it('rejects a ticker that shares almost no letters with its subject', () => {
    const result = validateTicker('ZQXWV', 'commuter ferret');
    expect(result.valid).toBe(false);
  });

  it('rejects an empty ticker', () => {
    expect(validateTicker('').valid).toBe(false);
  });
});

describe('generateTickerCandidates', () => {
  it('derives candidates from the subject words', () => {
    const candidates = generateTickerCandidates('commuter ferret');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((t) => t.length <= MAX_TICKER_LENGTH)).toBe(true);
    expect(candidates.every((t) => validateTicker(t).valid)).toBe(true);
    expect(candidates.some((t) => t.includes('FERRET') || t.includes('COMMUT'))).toBe(true);
  });

  it('is deterministic for the same subject', () => {
    expect(generateTickerCandidates('squat rack goose')).toEqual(
      generateTickerCandidates('squat rack goose'),
    );
  });

  it('drops generic filler words from the subject', () => {
    const candidates = generateTickerCandidates('the viral meme coin cat');
    expect(candidates.some((t) => t.startsWith('CAT'))).toBe(true);
    expect(candidates).not.toContain('COIN');
    expect(candidates).not.toContain('MEME');
  });

  it('returns no invalid candidates even for awkward subjects', () => {
    for (const subject of ['x', 'the', '???', 'a b', 'brrr']) {
      const candidates = generateTickerCandidates(subject);
      expect(candidates.every((t) => validateTicker(t).valid)).toBe(true);
    }
  });
});

describe('generateTokenName', () => {
  it('title-cases meaningful words', () => {
    expect(generateTokenName('commuter ferret')).toBe('Commuter Ferret');
  });

  it('caps the name at three words', () => {
    expect(generateTokenName('very long viral subject phrase here').split(' ').length).toBeLessThanOrEqual(3);
  });
});

describe('spellingVariants', () => {
  it('includes leet substitutions and plural forms', () => {
    const variants = spellingVariants('GOOSE');

    expect(variants).toContain('GOOSE');
    expect(variants).toContain('GOOSES');
    expect(variants).toContain('G00SE');
    expect(variants.every((v) => v.length <= MAX_TICKER_LENGTH)).toBe(true);
  });

  it('collapses doubled letters so near-misses are caught', () => {
    expect(spellingVariants('BUUNNY')).toContain('BUNY');
  });

  it('returns nothing for an empty input', () => {
    expect(spellingVariants('')).toEqual([]);
  });
});

describe('buildSuggestions', () => {
  it('returns a primary plus exactly three alternates', () => {
    const { primary, alternates } = buildSuggestions('commuter ferret', 'a ferret commutes');

    expect(primary.ticker.length).toBeLessThanOrEqual(MAX_TICKER_LENGTH);
    expect(alternates).toHaveLength(3);
  });

  it('produces alternates that are all distinct from the primary', () => {
    const { primary, alternates } = buildSuggestions('squat rack goose', 'goose guards the rack');
    const tickers = alternates.map((a) => a.ticker);

    expect(new Set(tickers).size).toBe(tickers.length);
    expect(tickers).not.toContain(primary.ticker);
  });

  it('still returns three alternates for a single-word subject', () => {
    const { alternates } = buildSuggestions('heron', 'a judgmental heron');
    expect(alternates).toHaveLength(3);
    expect(alternates.every((a) => a.ticker.length <= MAX_TICKER_LENGTH)).toBe(true);
  });

  it('carries the meme hook into the primary rationale', () => {
    const { primary } = buildSuggestions('cabinet cat', 'a cat refuses to leave the cabinet');
    expect(primary.rationale).toContain('cabinet cat');
  });
});
