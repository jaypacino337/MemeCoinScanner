/**
 * Meta taxonomy shared by the daily runner scan and the site inventory.
 *
 * A "meta" is a narrative bucket: the reason a coin (or one of our sites)
 * exists. Runners and sites are classified with the same keyword table, so a
 * site's grade can be read straight off how its meta is running on-chain today.
 *
 * Classification is deliberately plain keyword matching — every assignment can
 * be explained by pointing at the words that triggered it (`matchedTerms`).
 * Words that show up repeatedly in runners but hit no meta are surfaced by the
 * daily report as "unclassified words", which is how the table learns.
 */

export interface MetaDef {
  id: string;
  label: string;
  /** One line describing the narrative, shown next to the meta. */
  blurb: string;
  /** Lowercase terms; matched on word starts, so "dog" also hits "doge"/"dogs". */
  terms: string[];
}

export const METAS: MetaDef[] = [
  {
    id: 'tokenized-fund',
    label: 'Tokenized fund / reserve LARP',
    blurb: 'Coins cosplaying as funds, reserves, dividends or national assets.',
    terms: [
      'fund', 'trust', 'reserve', 'strategic', 'dividend', 'treasury', 'oil', 'petroleum',
      'protocol', 'institution', 'sovereign', 'relief', 'supply', 'tokeniz', 'rwa', 'bond',
      'gold', 'water', 'sarp', 'atfs', 'vsof', 'dotf',
    ],
  },
  {
    id: 'stocks-tradfi',
    label: 'Stocks & TradFi crossover',
    blurb: 'Tokenized equities, Robinhood, Wall Street, brokers and bank jokes.',
    terms: [
      'stock', 'robinhood', 'nasdaq', 'wallstreet', 'wall street', 'broker', 'equity', 'etf',
      'nyse', 'ipo', 'shares', 'xstock', 'tesla', 'nvidia', 'moderna', 'bank', 'ticker',
      'trader', 'trading', 'vanguard', 'blackrock',
    ],
  },
  {
    id: 'brand-cosplay',
    label: 'Big-brand / big-coin cosplay',
    blurb: 'Names borrowed from large companies or large coins (XRP, Google, SpaceX).',
    terms: [
      'xrp', 'ripple', 'google', 'spacex', 'apple', 'amazon', 'microsoft', 'openai', 'meta',
      'binance', 'coinbase', 'evernorth', 'usd', 'bitcoin', 'btc', 'eth', 'oura',
    ],
  },
  {
    id: 'america-politics',
    label: 'America / politics',
    blurb: 'Patriotic, government, election and policy narratives.',
    terms: [
      'america', 'usa', 'u.s', 'united states', 'trump', 'maga', 'president', 'government',
      'doge', 'senate', 'congress', 'election', 'federal', 'national', 'patriot', 'eagle',
    ],
  },
  {
    id: 'ai-agents',
    label: 'AI agents & AI culture',
    blurb: 'AI agents, AI influencers, models, bots and machine-intelligence jokes.',
    terms: [
      'ai', 'agent', 'gpt', 'intelligence', 'neural', 'robot', 'bot', 'llm',
      'agi', 'singularity', 'sentient', 'sentia', 'claude', 'claudia', 'grok', 'compute', 'gpu',
      'agency', 'hivemind', 'crawl', 'super agent', 'self-aware',
    ],
  },
  {
    id: 'dogs',
    label: 'Dogs',
    blurb: 'Dog mascots — the oldest meta on the chain.',
    terms: ['dog', 'doge', 'pup', 'puppy', 'shib', 'shiba', 'inu', 'wif', 'bonk', 'longdog', 'corgi', 'pug'],
  },
  {
    id: 'cats',
    label: 'Cats',
    blurb: 'Cat mascots and kitten characters.',
    terms: ['cat', 'kitten', 'kitty', 'meow', 'purr', 'popcat', 'mew', 'neko'],
  },
  {
    id: 'frogs-animals',
    label: 'Frogs & other animals',
    blurb: 'Pepe, frogs, fish and every other animal mascot.',
    terms: [
      'frog', 'pepe', 'peponk', 'fish', 'feesh', 'goat', 'monkey', 'ape', 'penguin', 'bear',
      'bull', 'fox', 'hippo', 'duck', 'goose', 'pigeon', 'rat', 'hamster', 'panda', 'crab',
      'crocodile', 'frogodile', 'otter', 'capybara', 'animal', 'squirrel', 'raccoon', 'beaver',
    ],
  },
  {
    id: 'brainrot',
    label: 'Brainrot & slang',
    blurb: 'Internet slang, catchphrases and pure nonsense tickers.',
    terms: [
      'brainrot', 'skibidi', 'rizz', 'sigma', 'gyatt', 'based', 'cope', 'wojak', 'chad',
      'retard', 'goif', 'bro', 'nah', 'fart', 'lol', 'meme', 'vibe', 'slop', 'mistake',
    ],
  },
  {
    id: 'gambling-games',
    label: 'Games, casino & gambling',
    blurb: 'On-chain games, dice, bingo, lotteries and degen mechanics.',
    terms: [
      'game', 'casino', 'dice', 'bingo', 'lottery', 'jackpot', 'bet', 'slot', 'poker',
      'deal or no deal', 'mining', 'miner', 'arcade', 'gaming', 'gamble', 'roulette',
    ],
  },
  {
    id: 'launchpad-platform',
    label: 'Launchpads & platforms',
    blurb: 'Products that launch, list or fund other coins.',
    terms: [
      'launchpad', 'launcher', 'platform', 'crowdfund', 'rally', 'creator', 'fee',
      'buyback', 'burn', 'dex', 'terminal', 'swap', 'bridge',
    ],
  },
  {
    id: 'airdrop-claim',
    label: 'Airdrops & claims',
    blurb: 'Claim pages, airdrops, rewards and holder payouts.',
    terms: ['airdrop', 'claim', 'reward', 'cashback', 'holder', 'payout', 'rebate'],
  },
  {
    id: 'prediction-markets',
    label: 'Prediction markets',
    blurb: 'Betting on real-world outcomes: Polymarket-style products.',
    terms: ['prediction', 'polymarket', 'kalshi', 'odds', 'forecast', 'overbid', 'markets'],
  },
  {
    id: 'livestream-social',
    label: 'Livestream & social stunts',
    blurb: 'Coins driven by a streamer, a live stunt, or a social-media moment.',
    terms: ['livestream', 'stream', 'tiktok', 'twitter', 'influencer', 'streamer', 'viral', 'clip'],
  },
  {
    id: 'apps-utility',
    label: 'Apps & utility',
    blurb: 'Coins pitched as a real app or tool: social apps, money apps, pools, margin.',
    terms: ['app', 'apps', 'pools', 'margin', 'irl', 'tweetcraft', 'toolkit', 'platform app', 'mini app'],
  },
  {
    id: 'defi-payments',
    label: 'DeFi & payments',
    blurb: 'Finance-app narratives: pay, vaults, dark pools, yield.',
    terms: ['finance', 'payr', 'payment', 'darkpool', 'dark pool', 'vault', 'yield', 'lend', 'stablecoin', 'wallet'],
  },
  {
    id: 'seasonal',
    label: 'Seasonal & calendar',
    blurb: 'Uptober, Halloween, Christmas and other dated moments.',
    terms: ['uptober', 'october', 'pumpkin', 'halloween', 'spooky', 'christmas', 'solmas', 'xmas', 'santa', 'thanksgiving', 'new year'],
  },
  {
    id: 'celebrity-culture',
    label: 'Celebrity & pop culture',
    blurb: 'Named people, films, music and sports moments.',
    terms: [
      'elon', 'musk', 'kanye', 'drake', 'taylor', 'movie', 'anime', 'nba', 'nfl', 'football',
      'soccer', 'rapper', 'album', 'film', 'mrbeast', 'tyson', 'youtuber',
    ],
  },
];

export const METAS_BY_ID: ReadonlyMap<string, MetaDef> = new Map(METAS.map((m) => [m.id, m]));

export const UNCLASSIFIED = 'unclassified';

export interface MetaMatch {
  metaId: string;
  /** Distinct terms that triggered the match. */
  matchedTerms: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Short terms that collide with ordinary words when matched as a prefix
 * ("ape" → "apex", "bet" → "better"). Other 3-letter terms match as prefixes so
 * "catius" and "dogwifhat" still classify.
 */
const WHOLE_WORD = new Set([
  'usd', 'eth', 'btc', 'bot', 'ape', 'rat', 'bet', 'etf', 'ipo', 'fee', 'mew', 'lol', 'bro',
  'nah', 'pug', 'inu', 'wif', 'win', 'oil', 'nba', 'nfl', 'agi', 'llm', 'gpt', 'rwa', 'fox',
  'pad', 'meta', 'bull', 'bear', 'gold', 'u.s', 'usa', 'pup', 'dex', 'fish', 'app', 'irl',
]);

/**
 * Mascot nouns that tickers glue onto the end of another word ("WHIPCAT",
 * "TEXCAT", "SHIBDOG"): these also match as a word suffix.
 */
const SUFFIX_OK = new Set(['cat', 'dog', 'frog', 'pepe', 'inu', 'doge', 'kitty', 'monkey', 'ape']);

const TERM_PATTERNS: Array<{ metaId: string; term: string; re: RegExp }> = METAS.flatMap((meta) =>
  meta.terms.map((term) => ({
    metaId: meta.id,
    term,
    // Word-start match; ≤2-char and WHOLE_WORD terms must be a whole word so
    // "ai" does not fire on "air" and "ape" does not fire on "apex".
    re:
      term.length <= 2 || WHOLE_WORD.has(term)
        ? new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}($|[^a-z0-9])`, 'i')
        : SUFFIX_OK.has(term)
          ? new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}|${escapeRegex(term)}($|[^a-z0-9])`, 'i')
          : new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}`, 'i'),
  })),
);

/**
 * Classifies free text into metas, strongest first (most distinct terms hit).
 * Returns an empty array when nothing matched — callers decide whether that
 * means "unclassified".
 */
export function classifyText(text: string): MetaMatch[] {
  const haystack = ` ${text.toLowerCase()} `;
  const hits = new Map<string, Set<string>>();
  for (const { metaId, term, re } of TERM_PATTERNS) {
    if (re.test(haystack)) {
      const set = hits.get(metaId) ?? new Set<string>();
      set.add(term);
      hits.set(metaId, set);
    }
  }
  return [...hits.entries()]
    .map(([metaId, terms]) => ({ metaId, matchedTerms: [...terms].sort() }))
    .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.metaId.localeCompare(b.metaId));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'that', 'this', 'from', 'are', 'was', 'not',
  'into', 'its', 'our', 'has', 'have', 'will', 'all', 'just', 'now', 'new', 'token', 'coin',
  'sol', 'pump', 'pumpfun', 'official', 'community', 'first', 'only', 'one', 'who', 'what',
  'http', 'https', 'com', 'www', 'deployed', 'using', 'j7tracker', 'io', 'fun',
]);

/** Lowercase word tokens worth counting for the "unclassified words" list. */
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}
