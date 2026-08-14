import type { LinkHealth, Platform, VerificationState } from '@/lib/domain/types';

/**
 * Link verification.
 *
 * The product rule is strict: a result is only displayable when its URL points
 * directly at the original post on the original platform. We never substitute a
 * search page, hashtag page, aggregator article, or repost compilation for a
 * dead link — a failed check degrades the result, it does not get papered over.
 */

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  TIKTOK: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'],
  INSTAGRAM: ['instagram.com', 'www.instagram.com'],
  X: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
};

/**
 * Canonical shapes for a single original post.
 * TikTok:    /@handle/video/1234  (also /@handle/photo/1234)
 * Instagram: /p/ABC, /reel/ABC, /tv/ABC
 * X:         /handle/status/1234
 */
const POST_PATH_PATTERNS: Record<Platform, RegExp[]> = {
  TIKTOK: [/^\/@[\w.\-]+\/(video|photo)\/\d+/i, /^\/v\/\d+/i],
  INSTAGRAM: [/^\/(p|reel|reels|tv)\/[\w-]+/i],
  X: [/^\/[\w]+\/status(es)?\/\d+/i],
};

/** Paths that are explicitly not a single original post. */
const NON_POST_PATH_PATTERNS: RegExp[] = [
  /^\/search/i,
  /^\/explore/i,
  /^\/tag\//i,
  /^\/hashtag\//i,
  /^\/discover/i,
  /^\/i\/flow/i,
  /^\/i\/topics/i,
  /^\/accounts\/login/i,
  /^\/trending/i,
];

/** Hosts that only ever host discussion *about* a post, never the post itself. */
const AGGREGATOR_HOSTS = [
  'knowyourmeme.com',
  'buzzfeed.com',
  'dailymail.co.uk',
  'ladbible.com',
  'unilad.com',
  'reddit.com',
  'imgur.com',
  'youtube.com',
  'news.google.com',
  'msn.com',
  'facebook.com',
  'pinterest.com',
  'dexerto.com',
  'sportskeeda.com',
];

export interface UrlShapeResult {
  ok: boolean;
  reason: string | null;
  health: LinkHealth;
  normalizedUrl: string | null;
  handle: string | null;
  postId: string | null;
}

function stripTrackingParams(url: URL): URL {
  const cleaned = new URL(url.toString());
  const drop = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'igshid',
    'igsh',
    'is_from_webapp',
    'sender_device',
    'web_id',
    's',
    't',
    'ref_src',
    'ref_url',
  ];
  for (const key of drop) cleaned.searchParams.delete(key);
  return cleaned;
}

/**
 * Structural check: is this URL shaped like a direct link to an original post
 * on the expected platform? Runs before any network call.
 */
export function checkUrlShape(rawUrl: string, platform: Platform): UrlShapeResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      reason: 'Malformed URL',
      health: 'UNREACHABLE',
      normalizedUrl: null,
      handle: null,
      postId: null,
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: `Unsupported protocol "${url.protocol}"`,
      health: 'UNREACHABLE',
      normalizedUrl: null,
      handle: null,
      postId: null,
    };
  }

  const host = url.hostname.toLowerCase();

  if (AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return {
      ok: false,
      reason: `Points at ${host}, which discusses posts rather than hosting the original`,
      health: 'NOT_ORIGINAL',
      normalizedUrl: null,
      handle: null,
      postId: null,
    };
  }

  const allowedHosts = PLATFORM_HOSTS[platform];
  if (!allowedHosts.includes(host)) {
    return {
      ok: false,
      reason: `Host "${host}" is not an official ${platform} domain`,
      health: 'NOT_ORIGINAL',
      normalizedUrl: null,
      handle: null,
      postId: null,
    };
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (NON_POST_PATH_PATTERNS.some((p) => p.test(path))) {
    return {
      ok: false,
      reason: 'Resolves to a search, hashtag, or listing page rather than one post',
      health: 'NOT_ORIGINAL',
      normalizedUrl: null,
      handle: null,
      postId: null,
    };
  }

  const matched = POST_PATH_PATTERNS[platform].some((p) => p.test(path));
  if (!matched) {
    return {
      ok: false,
      reason: `Path "${path}" does not match a single-post URL for ${platform}`,
      health: 'NOT_ORIGINAL',
      normalizedUrl: null,
      handle: null,
      postId: null,
    };
  }

  return {
    ok: true,
    reason: null,
    health: 'OK',
    normalizedUrl: stripTrackingParams(url).toString(),
    handle: extractHandle(url, platform),
    postId: extractPostId(url, platform),
  };
}

export function extractHandle(url: URL, platform: Platform): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  if (platform === 'TIKTOK') {
    return first.startsWith('@') ? first.slice(1).toLowerCase() : null;
  }
  if (platform === 'X') {
    return segments[1]?.toLowerCase().startsWith('status') ? first.toLowerCase() : null;
  }
  // Instagram short-code URLs do not carry the handle.
  return null;
}

export function extractPostId(url: URL, platform: Platform): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  if (platform === 'TIKTOK') {
    const idx = segments.findIndex((s) => s === 'video' || s === 'photo');
    return idx >= 0 ? (segments[idx + 1] ?? null) : null;
  }
  if (platform === 'INSTAGRAM') {
    const idx = segments.findIndex((s) => ['p', 'reel', 'reels', 'tv'].includes(s));
    return idx >= 0 ? (segments[idx + 1] ?? null) : null;
  }
  const idx = segments.findIndex((s) => s === 'status' || s === 'statuses');
  return idx >= 0 ? (segments[idx + 1] ?? null) : null;
}

export interface LinkVerification {
  health: LinkHealth;
  /** HTTP status when a request was actually made. */
  statusCode: number | null;
  checkedAt: Date;
  reason: string | null;
  finalUrl: string | null;
  /** True only when every gate passed. */
  verified: boolean;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; redirect?: RequestRedirect; signal?: AbortSignal },
) => Promise<{ status: number; url: string; ok: boolean }>;

export interface VerifyOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Handle stored alongside the candidate, compared against the URL's handle. */
  expectedHandle?: string | null;
  now?: () => Date;
  /** When false, only the structural check runs (offline/CI). */
  performNetworkCheck?: boolean;
}

/**
 * Full verification: structure, then reachability, then account agreement.
 * Any network failure yields UNREACHABLE/ACCESS_RESTRICTED — never a silent pass.
 */
export async function verifyPostUrl(
  rawUrl: string,
  platform: Platform,
  options: VerifyOptions = {},
): Promise<LinkVerification> {
  const now = options.now ?? (() => new Date());
  const checkedAt = now();

  const shape = checkUrlShape(rawUrl, platform);
  if (!shape.ok) {
    return {
      health: shape.health,
      statusCode: null,
      checkedAt,
      reason: shape.reason,
      finalUrl: null,
      verified: false,
    };
  }

  if (options.expectedHandle && shape.handle) {
    const expected = options.expectedHandle.replace(/^@/, '').toLowerCase();
    if (expected !== shape.handle) {
      return {
        health: 'ACCOUNT_MISMATCH',
        statusCode: null,
        checkedAt,
        reason: `URL belongs to @${shape.handle} but the stored creator is @${expected}`,
        finalUrl: shape.normalizedUrl,
        verified: false,
      };
    }
  }

  if (options.performNetworkCheck === false) {
    return {
      health: 'UNCHECKED',
      statusCode: null,
      checkedAt,
      reason: 'Network verification disabled in this environment',
      finalUrl: shape.normalizedUrl,
      verified: false,
    };
  }

  const doFetch = options.fetchImpl ?? defaultFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await doFetch(shape.normalizedUrl ?? rawUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    // A redirect that lands off-platform means the original is gone.
    const finalShape = checkUrlShape(response.url, platform);
    if (!finalShape.ok) {
      return {
        health: 'NOT_ORIGINAL',
        statusCode: response.status,
        checkedAt,
        reason: `Redirected to a non-post URL (${response.url})`,
        finalUrl: response.url,
        verified: false,
      };
    }

    if (response.status === 404 || response.status === 410) {
      return {
        health: 'UNREACHABLE',
        statusCode: response.status,
        checkedAt,
        reason: 'Post no longer exists',
        finalUrl: response.url,
        verified: false,
      };
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return {
        health: 'ACCESS_RESTRICTED',
        statusCode: response.status,
        checkedAt,
        reason:
          response.status === 429
            ? 'Platform rate-limited the verification request'
            : 'Platform blocked automated access; could not confirm the post',
        finalUrl: response.url,
        verified: false,
      };
    }

    if (!response.ok) {
      return {
        health: 'UNREACHABLE',
        statusCode: response.status,
        checkedAt,
        reason: `Unexpected HTTP ${response.status}`,
        finalUrl: response.url,
        verified: false,
      };
    }

    const redirected = response.url !== shape.normalizedUrl;
    return {
      health: redirected ? 'REDIRECTED' : 'OK',
      statusCode: response.status,
      checkedAt,
      reason: null,
      finalUrl: response.url,
      verified: true,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      health: 'UNREACHABLE',
      statusCode: null,
      checkedAt,
      reason: aborted ? 'Verification request timed out' : 'Verification request failed',
      finalUrl: null,
      verified: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    redirect: init?.redirect ?? 'follow',
    signal: init?.signal,
    headers: { 'user-agent': 'ViralCoinRadar/1.0 (+link-verification)' },
  });
  return { status: response.status, url: response.url, ok: response.ok };
};

/**
 * Maps link health + metric trust onto the verification state that drives
 * ranking. Anything short of a clean check ranks below verified results.
 */
export function deriveVerificationState(
  linkHealth: LinkHealth,
  metricsTrusted: boolean,
): VerificationState {
  if (linkHealth === 'NOT_ORIGINAL' || linkHealth === 'ACCOUNT_MISMATCH') return 'REJECTED';
  if (linkHealth === 'OK' || linkHealth === 'REDIRECTED') {
    return metricsTrusted ? 'VERIFIED' : 'PARTIALLY_VERIFIED';
  }
  return 'UNVERIFIED';
}
