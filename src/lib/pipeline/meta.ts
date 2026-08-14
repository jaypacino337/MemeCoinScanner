/**
 * "Today's Meta" — repeated patterns among recently-observed token launches.
 *
 * This is a descriptive summary of what has been *observed in the index we
 * searched*, offered as a creative prompt only. It is explicitly not a
 * prediction, a ranking of what will perform, or a claim about returns. Every
 * consumer of this module renders that caveat alongside the output.
 */

export interface MetaObservation {
  name: string;
  ticker: string;
  marketCapUsd: number | null;
  athMarketCapUsd: number | null;
  createdAt: Date | null;
  subjectTags: string[];
}

export interface MetaPattern {
  label: string;
  detail: string;
  /** How many of the observed launches show this pattern. */
  count: number;
  /** Share of the analysed set, 0..1. */
  share: number;
}

export interface MetaReport {
  windowDays: number;
  sampleSize: number;
  patterns: MetaPattern[];
  /** Stated plainly so the UI never has to invent a caveat. */
  caveat: string;
  computedAt: Date;
  /** False when there was too little data to say anything useful. */
  meaningful: boolean;
}

const THEME_KEYWORDS: Array<{ label: string; terms: string[] }> = [
  { label: 'Animal mascots', terms: ['cat', 'dog', 'goat', 'goose', 'pigeon', 'raccoon', 'ferret', 'crab', 'heron', 'frog', 'bird', 'panda'] },
  { label: 'Object-as-character', terms: ['lamp', 'bucket', 'train', 'machine', 'loaf', 'postbox', 'mushroom', 'tube', 'packet'] },
  { label: 'Catchphrase-driven', terms: ['no', 'said', 'bro', 'respectfully', 'theory', 'nah'] },
  { label: 'Occupation / role framing', terms: ['guy', 'lord', 'boss', 'landlord', 'gremlin', 'employee', 'commuter', 'sommelier'] },
  { label: 'AI-generated visuals', terms: ['ai', 'generated', 'cursed', 'model'] },
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Analyses observed launches and reports the repeated shapes.
 * Only launches with some measured traction are considered, so the meta is not
 * dominated by dust.
 */
export function computeMeta(
  observations: MetaObservation[],
  options: { windowDays?: number; now?: Date; minMarketCapUsd?: number } = {},
): MetaReport {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 7;
  const minMarketCap = options.minMarketCapUsd ?? 15_000;
  const cutoff = now.getTime() - windowDays * 86_400_000;

  const sample = observations.filter((o) => {
    const inWindow = o.createdAt === null ? false : o.createdAt.getTime() >= cutoff;
    const hadTraction =
      (o.marketCapUsd ?? 0) >= minMarketCap || (o.athMarketCapUsd ?? 0) >= minMarketCap;
    return inWindow && hadTraction;
  });

  const caveat =
    'Descriptive summary of launches observed in the index that was searched, over the stated window. It is a creative prompt only — not a prediction, not a ranking of what will perform, and not a statement about returns.';

  if (sample.length < 3) {
    return {
      windowDays,
      sampleSize: sample.length,
      patterns: [],
      caveat,
      computedAt: now,
      meaningful: false,
    };
  }

  const patterns: MetaPattern[] = [];
  const total = sample.length;

  const push = (label: string, detail: string, count: number): void => {
    if (count === 0) return;
    patterns.push({ label, detail, count, share: round2(count / total) });
  };

  // Theme clustering across names and subject tags.
  for (const theme of THEME_KEYWORDS) {
    const count = sample.filter((o) => {
      const haystack = `${o.name} ${o.subjectTags.join(' ')}`.toLowerCase();
      return theme.terms.some((t) => new RegExp(`\\b${t}`, 'i').test(haystack));
    }).length;
    push(
      theme.label,
      `${count} of ${total} observed launches in this window used this framing.`,
      count,
    );
  }

  // Ticker length: short tickers are a recurring shape worth noting.
  const shortTickers = sample.filter((o) => o.ticker.length <= 5).length;
  push(
    'Short tickers (≤5 characters)',
    `${shortTickers} of ${total} used a ticker of five characters or fewer.`,
    shortTickers,
  );

  // Multi-word names vs single-word names.
  const multiWord = sample.filter((o) => o.name.trim().split(/\s+/).length >= 2).length;
  push(
    'Two-or-more-word names',
    `${multiWord} of ${total} used a descriptive multi-word name rather than a single word.`,
    multiWord,
  );

  // Name/ticker agreement — does the ticker read as an abbreviation of the name?
  const tickerMatchesName = sample.filter((o) => {
    const initials = o.name
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
    const compact = o.name.replace(/[^A-Za-z]/g, '').toUpperCase();
    const ticker = o.ticker.toUpperCase();
    return compact.startsWith(ticker) || ticker === initials;
  }).length;
  push(
    'Ticker derived directly from the name',
    `${tickerMatchesName} of ${total} used a ticker readable straight off the token name.`,
    tickerMatchesName,
  );

  patterns.sort((a, b) => b.count - a.count);

  return {
    windowDays,
    sampleSize: total,
    patterns: patterns.slice(0, 6),
    caveat,
    computedAt: now,
    meaningful: true,
  };
}
