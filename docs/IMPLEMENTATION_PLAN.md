# Viral Coin Radar — Implementation Plan

## 0. Repository state
Empty repository, branch `claude/viral-coin-radar-nyelcp`. Greenfield build.

## 1. Stack
- Next.js 15 (App Router) + TypeScript (strict)
- Tailwind CSS v4 (dark trading-terminal theme)
- PostgreSQL 16 + Prisma ORM (SQL migration checked in)
- Vitest (unit + integration), ESLint, `tsc --noEmit`
- pino structured logging, zod env validation

## 2. Architecture layers
```
providers/        swappable adapters (tiktok, instagram, x, pumpfun)  <- fixtures when no creds
  ├ types.ts      PlatformProvider / TokenIndexProvider interfaces
  └ registry.ts   env-driven selection: fixture | http adapter
pipeline/         ingestion: discover -> snapshot -> verify -> score -> screen -> persist
  ├ velocity.ts   metric-snapshot derived growth math
  ├ scoring.ts    100-point model + penalties
  ├ ticker.ts     ticker generation/normalisation + 3 alternates
  ├ linkcheck.ts  URL resolution / originality / accessibility checks
  └ screening.ts  Pump.fun duplicate screening -> CLEAN/DUST_ONLY/OCCUPIED/UNCERTAIN
infra/            cache, rate limiter, job queue, scheduler, logger, env
server/           prisma client, repositories, query layer
app/              routes + UI
```

## 3. Data model (Prisma)
SocialAccount, SocialPost, MetricSnapshot, ViralCandidate, TokenConcept,
TokenSearchResult, PlatformProviderRecord, ScanRun, SavedIdea, Rejection,
DataSourceHealth. MetricSnapshot is append-only so velocity/acceleration/
7-day curve are derived, never stored as fabricated values.

## 4. Verification gates (run before a candidate is displayable)
1. URL resolves (HEAD/GET with timeout)
2. Host is the canonical platform host (not aggregator/article/search/hashtag page)
3. Post is accessible (not 404/410/login-wall)
4. Visible account matches stored creator handle
5. Metrics recency window respected
6. Metric source + confidence recorded; ESTIMATED metrics labelled, never silently shown as real
Failure -> `linkHealth` degraded, candidate marked UNVERIFIED and ranked below verified.

## 5. Scoring
25 virality / 20 recency+velocity / 15 clarity / 15 mascot / 10 PFP+expandability /
5 English engagement / 5 originality / 5 clean pump.fun. Penalties and hard excludes
applied afterwards, each recorded as a structured reason on the candidate.

## 6. Pump.fun screening
Exact ticker, exact name, spelling variants (leet/plural/space/vowel-drop), subject
match, linked-post match. Records mcap, ATH mcap, creation date, dust/abandoned
classification, plus the literal query strings and timestamp searched.
Occupied ticker -> auto-generate 3 alternates -> screen each.

## 7. Pages
Dashboard, TikTok/Instagram/X Radar, Duplicate Checker, Saved, Rejected/Occupied,
Settings + data-source health, Idea detail.

## 8. Tests
scoring, ticker generation, link validation, duplicate screening, velocity math,
filters, plus integration test of full `runScan` pipeline with in-memory store.

## 9. Honesty constraints
- No fabricated metrics: fixtures are flagged `SYNTHETIC_FIXTURE` end-to-end and the UI
  renders a persistent demo banner.
- No financial promises anywhere in copy.
- Screening output always states what was queried and when.
