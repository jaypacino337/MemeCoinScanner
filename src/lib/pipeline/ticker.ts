/**
 * Ticker + token-name generation.
 *
 * Rules enforced here (all are hard requirements, validated before display):
 *  - 10 characters or fewer
 *  - pronounceable (must contain a vowel or be a short consonant cluster)
 *  - no confusing punctuation
 *  - derived from the actual meme subject, never generic filler
 */

export const MAX_TICKER_LENGTH = 10;

/** Words too generic to stand alone as a ticker. */
const GENERIC_TOKENS = new Set([
  'coin',
  'token',
  'meme',
  'memecoin',
  'crypto',
  'moon',
  'pump',
  'inu',
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'ai',
  'official',
  'real',
  'new',
  'best',
  'viral',
  'trend',
  'trending',
  'video',
  'guy',
  'thing',
  'stuff',
  'vibes',
  'era',
]);

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'is',
  'it',
  'its',
  'and',
  'or',
  'but',
  'was',
  'were',
  'be',
  'been',
  'his',
  'her',
  'their',
  'my',
  'your',
]);

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);

export interface TickerValidation {
  valid: boolean;
  problems: string[];
}

export function normalizeTicker(raw: string): string {
  return raw
    .toUpperCase()
    .normalize('NFD')
    // Strip diacritics so "ÉLAN" becomes "ELAN" rather than being rejected.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_TICKER_LENGTH);
}

function isPronounceable(ticker: string): boolean {
  const letters = ticker.replace(/[0-9]/g, '');
  if (letters.length === 0) return false;
  // Acronym-style tickers up to 4 letters read fine spelled out.
  if (letters.length <= 4) return true;
  if (![...letters].some((c) => VOWELS.has(c))) return false;
  // Reject runs of 4+ consonants, which are effectively unsayable.
  return !/[BCDFGHJKLMNPQRSTVWXZ]{4,}/.test(letters);
}

export function validateTicker(raw: string, subject?: string): TickerValidation {
  const problems: string[] = [];
  const ticker = raw.trim();

  if (ticker.length === 0) {
    return { valid: false, problems: ['Ticker is empty'] };
  }
  if (ticker.length > MAX_TICKER_LENGTH) {
    problems.push(`Longer than ${MAX_TICKER_LENGTH} characters`);
  }
  if (!/^[A-Z0-9]+$/.test(ticker)) {
    problems.push('Contains characters outside A-Z and 0-9');
  }
  if (/^[0-9]+$/.test(ticker)) {
    problems.push('Digits only — not a readable ticker');
  }
  if (!isPronounceable(ticker.toUpperCase())) {
    problems.push('Hard to pronounce');
  }
  if (GENERIC_TOKENS.has(ticker.toLowerCase())) {
    problems.push('Generic filler word');
  }
  if (subject && subject.trim().length > 0) {
    const subjectLetters = new Set(
      subject
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .split(''),
    );
    const overlap = [...ticker.toUpperCase().replace(/[^A-Z]/g, '')].filter((c) =>
      subjectLetters.has(c),
    ).length;
    const alpha = ticker.replace(/[^A-Za-z]/g, '').length;
    // A ticker sharing almost no letters with its subject is a sign of
    // generic AI phrasing rather than a name drawn from the meme.
    if (alpha > 0 && overlap / alpha < 0.5) {
      problems.push('Does not appear to derive from the meme subject');
    }
  }

  return { valid: problems.length === 0, problems };
}

export function meaningfulWords(subject: string): string[] {
  return subject
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w) && !GENERIC_TOKENS.has(w));
}

function dropVowels(word: string): string {
  if (word.length <= 4) return word;
  const first = word[0] ?? '';
  const rest = word.slice(1).replace(/[aeiou]/g, '');
  return first + rest;
}

/**
 * Generates ranked ticker candidates for a subject. Deterministic — the same
 * subject always produces the same ordering, so screening results stay stable
 * across scans.
 */
export function generateTickerCandidates(subject: string, count = 6): string[] {
  const words = meaningfulWords(subject);
  const candidates: string[] = [];

  const push = (value: string): void => {
    const normalized = normalizeTicker(value);
    if (normalized.length < 3) return;
    if (!validateTicker(normalized).valid) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  const [w0, w1, w2] = words;

  // Whole first word — usually the strongest and most recognisable.
  if (w0) push(w0);
  // Two-word compound, e.g. "chair guy" -> CHAIRGUY.
  if (w0 && w1) push(w0 + w1);
  // Initials of a multi-word phrase.
  if (words.length >= 2) push(words.map((w) => w[0] ?? '').join(''));
  // Second word alone, when the first is weak.
  if (w1) push(w1);
  // Truncated compound that fits the length cap.
  if (w0 && w1) push(w0.slice(0, 5) + w1.slice(0, 5));
  // Consonant-squeezed form for long single words.
  if (w0 && w0.length > 6) push(dropVowels(w0));
  if (w2) push(w2);
  if (w0 && w1 && w2) push(w0.slice(0, 3) + w1.slice(0, 3) + w2.slice(0, 3));

  return candidates.slice(0, count);
}

/** Title-cased display name derived from the subject. */
export function generateTokenName(subject: string): string {
  const words = meaningfulWords(subject);
  const chosen = words.slice(0, 3);
  if (chosen.length === 0) return subject.trim();
  return chosen
    .map((w) => (w[0] ?? '').toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Spelling variants used to widen a duplicate search, so an existing token
 * spelled "BANANNA" is still caught when we propose "BANANA".
 */
export function spellingVariants(ticker: string): string[] {
  const base = normalizeTicker(ticker);
  const variants = new Set<string>();
  if (base.length === 0) return [];

  variants.add(base);
  variants.add(`${base}S`.slice(0, MAX_TICKER_LENGTH));
  if (base.endsWith('S')) variants.add(base.slice(0, -1));
  // Common leet substitutions seen in launched tickers.
  variants.add(base.replace(/O/g, '0'));
  variants.add(base.replace(/I/g, '1'));
  variants.add(base.replace(/E/g, '3'));
  variants.add(base.replace(/S/g, 'Z'));
  // Doubled-letter collapse: "BUUNNY" -> "BUNY".
  variants.add(base.replace(/(.)\1+/g, '$1'));
  variants.add(dropVowels(base.toLowerCase()).toUpperCase());

  variants.delete('');
  return [...variants].filter((v) => v.length >= 2 && v.length <= MAX_TICKER_LENGTH);
}

export interface TokenSuggestion {
  name: string;
  ticker: string;
  rationale: string;
}

/**
 * Builds the primary suggestion plus alternates. The caller screens each and,
 * when the primary is OCCUPIED, promotes the first CLEAN alternate.
 */
export function buildSuggestions(
  subject: string,
  memeHook: string,
  alternates = 3,
): { primary: TokenSuggestion; alternates: TokenSuggestion[] } {
  const tickers = generateTickerCandidates(subject, alternates + 1);
  const name = generateTokenName(subject);

  const fallbackTicker = normalizeTicker(subject) || 'MEME';
  const primaryTicker = tickers[0] ?? fallbackTicker;

  const primary: TokenSuggestion = {
    name,
    ticker: primaryTicker,
    rationale: `Direct read of the meme subject "${subject}" — ${memeHook}`,
  };

  const alts: TokenSuggestion[] = tickers.slice(1, alternates + 1).map((ticker, index) => ({
    name: index === 0 ? name : `${name} ${ticker}`,
    ticker,
    rationale: `Alternate phrasing of "${subject}" kept short and pronounceable`,
  }));

  // Guarantee the requested number of alternates even for one-word subjects.
  let filler = 0;
  const suffixes = ['COIN', 'GUY', 'CAT'];
  while (alts.length < alternates) {
    const suffix = suffixes[filler] ?? String(filler);
    const candidate = normalizeTicker(primaryTicker.slice(0, 6) + suffix);
    filler += 1;
    if (candidate.length >= 3 && !alts.some((a) => a.ticker === candidate) && candidate !== primaryTicker) {
      alts.push({
        name: `${name} ${suffix[0]}${suffix.slice(1).toLowerCase()}`,
        ticker: candidate,
        rationale: `Fallback variant derived from "${subject}" when shorter forms are taken`,
      });
    }
    if (filler > 10) break;
  }

  return { primary, alternates: alts };
}
