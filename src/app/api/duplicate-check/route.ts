import { NextResponse } from 'next/server';
import { z } from 'zod';
import { screenConcept } from '@/lib/pipeline/screening';
import { buildSuggestions, normalizeTicker, validateTicker } from '@/lib/pipeline/ticker';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { getRegistry } from '@/server/scan-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  subject: z.string().min(2).max(120),
  name: z.string().min(1).max(80).optional(),
  ticker: z.string().min(1).max(20).optional(),
  postUrl: z.string().url().optional(),
  /** When true, also screen three generated alternates. */
  includeAlternates: z.boolean().default(true),
});

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    const limited = enforceRateLimit(request, 3);
    if (limited) return limited;

    const raw: unknown = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues[0]?.message);
    }

    const { subject, includeAlternates, postUrl } = parsed.data;
    const generated = buildSuggestions(subject, 'manual duplicate check', 3);

    const primary = {
      name: parsed.data.name ?? generated.primary.name,
      ticker: parsed.data.ticker ? normalizeTicker(parsed.data.ticker) : generated.primary.ticker,
    };

    const tickerValidation = validateTicker(primary.ticker, subject);
    const registry = getRegistry();

    const candidates = includeAlternates
      ? [primary, ...generated.alternates.filter((a) => a.ticker !== primary.ticker)]
      : [primary];

    const reports = [];
    for (const candidate of candidates) {
      const response = await registry.tokenIndex.search({
        name: candidate.name,
        ticker: candidate.ticker,
        subject,
        postUrl,
      });
      const report = screenConcept({
        name: candidate.name,
        ticker: candidate.ticker,
        subject,
        postUrl,
        response,
      });
      reports.push({
        name: candidate.name,
        ticker: candidate.ticker,
        isPrimary: candidate.ticker === primary.ticker,
        validation: validateTicker(candidate.ticker, subject),
        status: report.status,
        statement: report.statement,
        queries: report.queries,
        searchedAt: report.searchedAt,
        indexComplete: report.indexComplete,
        matches: report.matches.map((m) => ({
          matchType: m.matchType,
          quality: m.quality,
          note: m.note,
          token: {
            name: m.token.name,
            ticker: m.token.ticker,
            mintAddress: m.token.mintAddress,
            url: m.token.url,
            marketCapUsd: m.token.marketCapUsd,
            athMarketCapUsd: m.token.athMarketCapUsd,
            createdAt: m.token.createdAt,
            holders: m.token.holders,
            source: m.token.source,
            confidence: m.token.confidence,
          },
        })),
      });
    }

    return NextResponse.json(
      serialize({
        subject,
        indexProvider: { name: registry.tokenIndex.name, mode: registry.tokenIndex.mode },
        primaryTickerValidation: tickerValidation,
        reports,
      }),
    );
  });
}
