# Viral Coin Radar

Discovers, verifies, and ranks viral content from TikTok, Instagram Reels, and X
that could inspire original meme-token concepts — then screens every suggested
name and ticker against a Pump.fun-style token index before showing it to you.

Built around one principle: **a number on screen must correspond to an
observation that actually exists.** Metrics carry their source and confidence,
growth is derived from stored snapshots rather than asserted, links are verified
before display, and duplicate screening states exactly what was searched and
when.

> Views are not evidence that a token will perform. Nothing here is financial
> advice or a prediction of returns.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env          # only DATABASE_URL is strictly required

# 3. Create the schema
npx prisma migrate deploy     # or: npx prisma migrate dev

# 4. Load the demo dataset (synthetic, clearly labelled)
npm run db:seed

# 5. Run
npm run dev                   # http://localhost:3000
```

With no credentials configured the app runs in **fixture mode**: every post,
metric, and token match is synthetic, tagged `SYNTHETIC_FIXTURE` /
`UNVERIFIED`, and a persistent banner says so on every page. See
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) to go live.

### Verify everything

```bash
npm run verify     # lint + typecheck + tests + production build
npm run smoke      # asserts pages render (needs the app running)
```

`npm run smoke` checks rendered **content**, not status codes — Next.js serves
its error boundary with HTTP 200, so a status-only check passes on a page whose
server render threw.

---

## What it does

### Discovery
Sweeps each platform provider over a configurable window (7-day primary, 14-day
early-signal, 90-day rediscovery), applies threshold filters, and keeps only
posts that survive verification.

### Verification (before anything is displayed)
1. URL is a canonical single-post link on the canonical platform host
2. The post resolves and is accessible
3. Redirects still land on the original post
4. The URL's handle matches the stored creator
5. Metrics carry a source and confidence; unverified metrics are penalised, and
   unverified results always rank below verified ones

Aggregator articles, repost compilations, search pages, and hashtag pages are
rejected outright. **A broken link is never silently replaced with a search page.**

### Scoring — 100 points
| Component | Weight |
|---|---|
| Verified virality | 25 |
| Recency & view velocity | 20 |
| Meme clarity | 15 |
| Visual / mascot potential | 15 |
| PFP & content expandability | 10 |
| English-speaking engagement | 5 |
| Originality | 5 |
| Clean Pump.fun search | 5 |

Penalties: unverified metrics (−18), stale trend with no resurgence (−15),
occupied token (−20), dust-only matches (−6), incomplete screening (−5),
sponsored campaign (−8), celebrity/IP dependence (−10), weak sourcing (−6).

Hard exclusions: broken or indirect source; tragedy, illness, or vulnerable
subject; generic content with no recognisable central joke.

### Pump.fun screening
For every name and ticker, the index is queried for exact ticker, exact name,
close spelling variants (leet, plural, doubled-letter collapse, vowel-drop), the
same viral subject under another ticker, and tokens linked to the source post.

| Status | Meaning |
|---|---|
| 🟢 `CLEAN` | No exact or meaningful subject match in the searched results |
| 🟡 `DUST_ONLY` | Matches exist but show no meaningful traction |
| 🟡 `UNCERTAIN` | Insufficient reliable information, or the index was unreachable |
| 🔴 `OCCUPIED` | An established token already uses the name, ticker, or subject |

When a ticker is occupied, three alternates are generated and screened, and the
first clean one is promoted. Every ticker is ≤10 characters, pronounceable, free
of confusing punctuation, and validated against the meme subject before display.

### Today's meta
Describes repeated patterns among launches observed in the searched index. It is
a creative prompt, presented with that caveat attached — never a prediction.

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Top opportunities, today's meta, fastest-growing, new animals, brainrot & phrases, cleanest untapped, platform distribution |
| `/tiktok`, `/instagram`, `/x` | Top 25 ranked ideas per platform with the full filter set |
| `/idea/[id]` | Media, metrics, growth chart, thesis, name + 3 alternates, screening tables, risks, actions |
| `/duplicate-checker` | Screen any name/ticker/subject on demand |
| `/saved` | Kept ideas |
| `/rejected` | Rejected by you, blocked by an existing token, or excluded by the pipeline |
| `/settings` | Data-source health, credentials detected, scan history, scoring model |

Filters live in the URL, so any filtered view is shareable and survives a reload.

---

## Architecture

```
src/
  env.ts                 zod-validated environment
  lib/
    domain/types.ts      shared domain types (no DB dependency)
    infra/               logger · cache · rate limiter · job queue
    providers/           swappable adapters + registry
      types.ts           PlatformProvider / TokenIndexProvider interfaces
      fixture-platform.ts, http-platform.ts, pumpfun.ts, registry.ts
    pipeline/            pure logic — no storage
      run-scan.ts        discover → filter → verify → screen → score → rank
      scoring.ts  velocity.ts  ticker.ts  linkcheck.ts  screening.ts
      filters.ts  meta.ts
    fixtures/            synthetic demo seeds
  server/                prisma client · persistence · queries · scan service
  app/                   routes + UI
```

Two boundaries do most of the work:

- **`runScan` is storage-free.** It takes providers in and returns candidate
  drafts out, so the whole pipeline is integration-tested without a database.
- **Every integration is an interface.** TikTok, Instagram, X, and the token
  index can each be swapped independently; provider selection is per-platform,
  so live X access and fixture TikTok is a supported state.

### Data model
`SocialAccount`, `SocialPost`, `MetricSnapshot`, `ViralCandidate`,
`TokenConcept`, `TokenSearchResult`, `RiskNote`, `PlatformProviderRecord`,
`ScanRun`, `Job`, `SavedIdea`, `Rejection`, `DataSourceHealth`, `CacheEntry`.

`MetricSnapshot` is **append-only**. Views-per-hour, likes-per-hour, engagement
acceleration, the 7-day curve, and momentum are all derived from consecutive
snapshots at read time — never stored as a mutable number that could drift into
fiction. With only one snapshot, velocity reports `null` and the UI says
"insufficient history" rather than showing a fabricated rate.

---

## Scheduled ingestion

Two endpoints, both authenticated with `CRON_SECRET`:

```bash
# Enqueue the primary sweep, the early-signal sweep, and a cache purge
curl -X POST https://your-host/api/cron/scan \
  -H "Authorization: Bearer $CRON_SECRET"

# Drain the job queue — run this on a short interval
curl -X POST https://your-host/api/cron/worker \
  -H "Authorization: Bearer $CRON_SECRET"
```

crontab:
```cron
*/30 * * * * curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/scan
*/2  * * * * curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/worker
```

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/worker", "schedule": "*/2 * * * *" }
  ]
}
```

The queue is Postgres-backed (no Redis) and claims jobs with
`FOR UPDATE SKIP LOCKED`, so multiple workers can drain it safely. Failures
retry with exponential backoff, then land in `DEAD` and surface on `/settings`.

You can also scan from the CLI:
```bash
npm run scan -- --platform TIKTOK --min-views 1000000 --window-days 14
```

---

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/feed?platform=&limit=&category=&screeningStatus=&minScore=` | Ranked candidates |
| `GET` | `/api/candidates/[id]` | One candidate |
| `POST`/`DELETE` | `/api/candidates/[id]/save` | Save / unsave |
| `POST`/`DELETE` | `/api/candidates/[id]/reject` | Reject / clear |
| `POST` | `/api/candidates/[id]/rescan` | Re-read metrics and re-score |
| `POST` | `/api/scan` | Run a scan with filters |
| `POST` | `/api/duplicate-check` | Screen a name/ticker/subject |
| `GET` | `/api/health` | Data-source and database health |

All routes are rate limited per client (expensive routes cost more budget) and
return structured JSON errors.

---

## Tests

```bash
npm test
```

122 tests covering scoring and ranking, ticker generation and validation, link
validation, duplicate screening, velocity math, filters, cache, rate limiter,
job queue, and a full integration pass over `runScan`.

---

## Stack

Next.js 15 (App Router) · TypeScript (strict, `noUncheckedIndexedAccess`) ·
Tailwind CSS v4 · PostgreSQL 16 · Prisma 6 · Vitest · pino · zod
