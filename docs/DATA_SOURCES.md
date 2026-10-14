# Data sources — what live access actually requires

This document is deliberately blunt about a constraint that shapes the whole
application: **no API access is fabricated anywhere in this codebase.** Every
integration sits behind an interface with two implementations — a labelled
fixture adapter and an HTTP adapter — and the app ships wired to the fixtures.

If a credential is absent, the matching provider says so on
`/settings` (`CREDENTIALS_MISSING`) and serves synthetic data tagged
`SYNTHETIC_FIXTURE` / `UNVERIFIED` end-to-end. It never presents demo numbers as
live measurements.

---

## The core problem

None of TikTok, Instagram, or X exposes a public, unauthenticated endpoint that
answers the question this product asks — *"which posts are going viral right now,
with view counts?"* Specifically:

| Platform | Official API | Does it serve "currently viral posts + views"? |
|---|---|---|
| TikTok | [Display API](https://developers.tiktok.com/doc/display-api-overview) | No. Only content belonging to a user who has authorised your app via OAuth. |
| TikTok | [Research API](https://developers.tiktok.com/doc/research-api-specs-query-videos) | Yes, closest fit — public video query with view/like/comment/share counts. **Restricted to approved academic and, in some regions, non-profit researchers.** |
| Instagram | [Graph API](https://developers.facebook.com/docs/instagram-api) | No. Business/Creator accounts you manage. Insights are first-party only. |
| Instagram | [oEmbed](https://developers.facebook.com/docs/instagram/oembed) | Embed HTML only — no metrics, no discovery. |
| X | [API v2](https://docs.x.com/x-api) | Partially. Recent search plus public metrics exists, but view counts (`impression_count`) and the volume needed for trend sweeps sit on paid tiers. |

The honest consequence: a production deployment of this app needs **either** an
approved official programme **or** a commercial data provider that is licensed to
redistribute this data. This codebase does not pick one for you, and it does not
pretend to have one.

---

## How to go live

Set `DATA_MODE="live"` and provide a base URL plus key per platform. Each
`*_API_BASE_URL` points at whatever you are licensed to call — the official API
via a thin translation layer of your own, or a provider that already speaks a
similar shape.

Selection is **per platform**. Holding X access but not TikTok access is a
supported state: X runs live while TikTok keeps serving fixtures.

### Expected response contract

`HttpPlatformProvider` (`src/lib/providers/http-platform.ts`) calls:

```
GET {BASE_URL}/discover?platform=TIKTOK&windowDays=7&minViews=3000000&limit=50
GET {BASE_URL}/post?platform=TIKTOK&postId=<id>
```

Auth header is `x-api-key: <key>` for TikTok/Instagram and
`Authorization: Bearer <token>` for X.

Response, validated by zod — a payload that does not match is **rejected
wholesale** rather than producing half-populated results:

```jsonc
{
  // How the upstream obtained these numbers. Drives the confidence label and
  // the unverified-metrics penalty. Be truthful here; it is the whole point.
  "metricSource": "OFFICIAL_API",   // | PUBLIC_PAGE | THIRD_PARTY_AGGREGATOR | ESTIMATED
  "items": [
    {
      "postId": "7411000000000000001",
      "url": "https://www.tiktok.com/@handle/video/7411000000000000001",
      "postedAt": "2026-08-12T09:00:00Z",
      "caption": "…",
      "thumbnailUrl": "https://…",      // optional
      "embedUrl": "https://…",          // optional
      "embedAllowed": true,             // optional
      "language": "en",                 // optional
      "englishCommentRatio": 0.91,      // optional, 0..1, from sampled comments
      "hashtags": ["goat"],             // optional
      "account": {
        "handle": "handle",
        "displayName": "Display Name",  // optional
        "profileUrl": "https://www.tiktok.com/@handle",
        "followerCount": 1240000,       // optional
        "verified": false               // optional
      },
      "metrics": {
        "capturedAt": "2026-08-14T12:00:00Z",  // optional, defaults to now
        "views": 41800000,
        "likes": 6100000,
        "comments": 88000,
        "shares": 940000
      },
      // Optional prior observations. Supplying these gives velocity and
      // momentum immediately instead of after the second scan.
      "metricHistory": [
        { "capturedAt": "2026-08-13T12:00:00Z", "views": 28000000, "likes": 4100000 }
      ],
      // Optional editorial enrichment. Anything omitted is treated as UNKNOWN
      // by the scorer (partial credit) rather than assumed favourable.
      "signals": {
        "category": "ANIMAL",
        "subject": "weather goat",
        "memeHook": "A goat stares at the sky…",
        "whyItLands": "…",
        "mascotDirection": "…",
        "memeClarity": 0.92,        // 0..1
        "characterStrength": 0.88,  // 0..1
        "pfpSuitability": 0.90,     // 0..1
        "expandability": 0.82,      // 0..1
        "originality": 0.74,        // 0..1
        "sponsored": false,
        "isStaleTrendRevival": false,
        "knownAliases": ["forecast goat"]
      }
    }
  ]
}
```

The `signals` block is where a human curator or a classification model plugs in.
The pipeline works without it — those components simply score as unknown.

---

## Pump.fun duplicate screening

`PUMPFUN_API_BASE_URL` should point at a Pump.fun-compatible search/index
endpoint you are permitted to query.

```
GET {PUMPFUN_API_BASE_URL}/search?symbol=FERRET&name=Commuter+Ferret&q=commuter+ferret
```

```jsonc
{
  "tokens": [
    {
      "mint": "…",
      "name": "Commuter Ferret",
      "symbol": "FERRET",
      "url": "https://pump.fun/coin/…",
      "marketCapUsd": 1840000,
      "athMarketCapUsd": 4200000,     // optional; drives abandoned-vs-dust
      "createdAt": "2026-08-09T00:00:00Z",
      "holders": 7400,
      "linkedPostUrl": "https://…",   // optional; catches same-post launches
      "subjectTags": ["cabinet cat"]  // optional; catches same-subject launches
    }
  ],
  "complete": true   // false when results were truncated
}
```

**`complete` matters.** When it is `false` — or the request fails, times out, or
returns a malformed body — the screener reports `UNCERTAIN`, never `CLEAN`. An
unreachable index must never read as "no duplicates found".

### What screening can and cannot tell you

It reports what the queries returned at the moment they ran. Every report
carries the literal query strings and a timestamp, and the wording is
constrained accordingly:

> Searched the token index for "ticker:FERRET", "name:Commuter Ferret",
> "subject:commuter ferret" at 2026-08-14T16:08:00.000Z. No exact ticker, exact
> name, close spelling variant, or same-subject match was found in those
> results. This describes what these queries returned at that time — it is not a
> claim that no such token has ever existed.

The app will not say a concept has never existed, because no search can
establish that.

---

## Wallet scanner

`SOLANA_RPC_URL` can be any standard Solana JSON-RPC endpoint — the public
mainnet RPC, Helius, QuickNode, Triton, or your own node. No custom contract is
involved: the scanner uses only `getSignaturesForAddress` and `getTransaction`.

```
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
# or e.g. https://mainnet.helius-rpc.com/?api-key=<key>
```

With `DATA_MODE=live` and this set, `/wallets` (and `npm run scan:wallet`)
reads the wallet's real transactions for the selected UTC day and derives
swaps from balance deltas: a transaction counts as a swap only when exactly
one non-SOL token holding changed against an opposite SOL (or wrapped-SOL)
flow. Token-to-token routes are listed with no SOL price rather than priced by
guesswork, and anything unclassifiable is counted and reported as unparsed.

The same honesty rules as everywhere else apply:

- **Realized PnL** exists only for round trips completed inside the scanned
  window. A sell of tokens bought before the window has no observed cost basis
  and is labelled `SELL_ONLY`, not scored.
- **Unrealized PnL is never shown** — the scanner does not fetch current
  prices, so it does not pretend to know them.
- Truncated pagination, RPC failures, and unparsed transactions all surface in
  the report note and the strategy profile's caveats, never silently.
- Public RPC endpoints rate-limit aggressively; for a busy wallet use a keyed
  endpoint and/or raise `WALLET_SCAN_MAX_TRANSACTIONS` (default 1000).

Without `SOLANA_RPC_URL`, the page serves a deterministic synthetic trading
day tagged `SYNTHETIC_FIXTURE` and says so in a banner.

---

## Link verification

Independent of platform credentials, every candidate URL passes:

1. **Structural check** — canonical single-post shape on the canonical host
   (`/@handle/video/<id>`, `/reel/<code>`, `/handle/status/<id>`). Aggregator
   hosts, search pages, hashtag pages, and profile URLs are rejected outright.
2. **Reachability** — resolved over HTTP; 404/410 → `UNREACHABLE`,
   401/403/429 → `ACCESS_RESTRICTED`.
3. **Redirect integrity** — a redirect landing off the original post is
   `NOT_ORIGINAL`. A broken link is *never* silently replaced with a search page.
4. **Account agreement** — the handle in the URL must match the stored creator,
   or the result is `ACCOUNT_MISMATCH` and is rejected.

Platforms actively block automated requests, so `ACCESS_RESTRICTED` is a normal
outcome in production. Those results are labelled **Unverified** and always rank
below verified ones — they are not hidden, and they are not promoted.

Set `ENABLE_LINK_VERIFICATION="false"` in offline or CI environments; every
result then displays as Unverified, which is the truthful state.

---

## Legal and ToS note

Scraping these platforms generally violates their Terms of Service, and in some
jurisdictions raises further issues. This codebase deliberately ships **no
scraper**. The HTTP adapters call a base URL that you supply, and it is your
responsibility to ensure that route is one you are permitted to use and to
redistribute from.
