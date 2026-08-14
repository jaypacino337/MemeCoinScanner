import { describe, expect, it, vi } from 'vitest';
import {
  checkUrlShape,
  deriveVerificationState,
  verifyPostUrl,
  type FetchLike,
} from '@/lib/pipeline/linkcheck';

const NOW = new Date('2026-08-14T12:00:00Z');
const now = (): Date => NOW;

function fakeFetch(response: { status: number; url?: string; ok?: boolean }): FetchLike {
  return vi.fn(async (url: string) => ({
    status: response.status,
    url: response.url ?? url,
    ok: response.ok ?? (response.status >= 200 && response.status < 300),
  }));
}

describe('checkUrlShape', () => {
  it('accepts canonical single-post URLs on each platform', () => {
    expect(
      checkUrlShape('https://www.tiktok.com/@demo_user/video/7411000000000000001', 'TIKTOK').ok,
    ).toBe(true);
    expect(checkUrlShape('https://www.instagram.com/reel/ABC123/', 'INSTAGRAM').ok).toBe(true);
    expect(checkUrlShape('https://x.com/demo_user/status/1811000000000000001', 'X').ok).toBe(true);
    expect(
      checkUrlShape('https://twitter.com/demo_user/status/1811000000000000001', 'X').ok,
    ).toBe(true);
  });

  it('rejects aggregator and article hosts that merely discuss a post', () => {
    for (const url of [
      'https://knowyourmeme.com/memes/commuter-ferret',
      'https://www.reddit.com/r/memes/comments/abc/',
      'https://www.dailymail.co.uk/news/article-123',
    ]) {
      const result = checkUrlShape(url, 'TIKTOK');
      expect(result.ok).toBe(false);
      expect(result.health).toBe('NOT_ORIGINAL');
    }
  });

  it('rejects a URL on the wrong platform host', () => {
    const result = checkUrlShape('https://www.instagram.com/reel/ABC123/', 'TIKTOK');
    expect(result.ok).toBe(false);
    expect(result.health).toBe('NOT_ORIGINAL');
  });

  it('rejects search, hashtag, and explore pages', () => {
    for (const url of [
      'https://www.tiktok.com/search?q=ferret',
      'https://www.tiktok.com/tag/ferret',
      'https://www.instagram.com/explore/tags/goose/',
    ]) {
      const platform = url.includes('instagram') ? 'INSTAGRAM' : 'TIKTOK';
      const result = checkUrlShape(url, platform);
      expect(result.ok).toBe(false);
      expect(result.health).toBe('NOT_ORIGINAL');
    }
  });

  it('rejects a profile URL that is not a single post', () => {
    expect(checkUrlShape('https://www.tiktok.com/@demo_user', 'TIKTOK').ok).toBe(false);
    expect(checkUrlShape('https://x.com/demo_user', 'X').ok).toBe(false);
  });

  it('rejects malformed URLs and unsupported protocols', () => {
    expect(checkUrlShape('not a url', 'TIKTOK').ok).toBe(false);
    expect(checkUrlShape('ftp://www.tiktok.com/@a/video/1', 'TIKTOK').ok).toBe(false);
  });

  it('strips tracking parameters from the normalised URL', () => {
    const result = checkUrlShape(
      'https://www.tiktok.com/@demo_user/video/7411?is_from_webapp=1&utm_source=x&web_id=9',
      'TIKTOK',
    );
    expect(result.ok).toBe(true);
    expect(result.normalizedUrl).not.toContain('utm_source');
    expect(result.normalizedUrl).not.toContain('is_from_webapp');
  });

  it('extracts the handle and post id where the URL carries them', () => {
    const tiktok = checkUrlShape('https://www.tiktok.com/@demo_user/video/7411', 'TIKTOK');
    expect(tiktok.handle).toBe('demo_user');
    expect(tiktok.postId).toBe('7411');

    const x = checkUrlShape('https://x.com/Demo_User/status/1811', 'X');
    expect(x.handle).toBe('demo_user');
    expect(x.postId).toBe('1811');

    // Instagram short-codes do not encode the handle; null, not a guess.
    const ig = checkUrlShape('https://www.instagram.com/reel/ABC123/', 'INSTAGRAM');
    expect(ig.handle).toBeNull();
    expect(ig.postId).toBe('ABC123');
  });
});

describe('verifyPostUrl', () => {
  const goodUrl = 'https://www.tiktok.com/@demo_user/video/7411000000000000001';

  it('verifies a reachable original post', async () => {
    const result = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl: fakeFetch({ status: 200 }),
      now,
      expectedHandle: 'demo_user',
    });

    expect(result.verified).toBe(true);
    expect(result.health).toBe('OK');
    expect(result.statusCode).toBe(200);
  });

  it('flags an account mismatch without making a network call', async () => {
    const fetchImpl = fakeFetch({ status: 200 });
    const result = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl,
      now,
      expectedHandle: 'someone_else',
    });

    expect(result.verified).toBe(false);
    expect(result.health).toBe('ACCOUNT_MISMATCH');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('marks a deleted post as unreachable', async () => {
    const result = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl: fakeFetch({ status: 404 }),
      now,
    });

    expect(result.verified).toBe(false);
    expect(result.health).toBe('UNREACHABLE');
  });

  it('distinguishes a platform block from a dead link', async () => {
    const blocked = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl: fakeFetch({ status: 403 }),
      now,
    });
    expect(blocked.health).toBe('ACCESS_RESTRICTED');

    const limited = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl: fakeFetch({ status: 429 }),
      now,
    });
    expect(limited.health).toBe('ACCESS_RESTRICTED');
    expect(limited.reason).toMatch(/rate-limited/i);
  });

  it('rejects a redirect that lands off the original post', async () => {
    const result = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl: fakeFetch({ status: 200, url: 'https://www.tiktok.com/search?q=ferret' }),
      now,
    });

    expect(result.verified).toBe(false);
    expect(result.health).toBe('NOT_ORIGINAL');
    // The critical guarantee: a broken link is never silently swapped for a
    // working search page.
    expect(result.finalUrl).toContain('search');
  });

  it('reports a timeout as unreachable rather than passing it', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const result = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl: vi.fn(async () => {
        throw abortError;
      }),
      now,
    });

    expect(result.verified).toBe(false);
    expect(result.health).toBe('UNREACHABLE');
    expect(result.reason).toMatch(/timed out/i);
  });

  it('returns UNCHECKED when network verification is disabled', async () => {
    const fetchImpl = fakeFetch({ status: 200 });
    const result = await verifyPostUrl(goodUrl, 'TIKTOK', {
      fetchImpl,
      now,
      performNetworkCheck: false,
    });

    expect(result.health).toBe('UNCHECKED');
    expect(result.verified).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never makes a request for a structurally invalid URL', async () => {
    const fetchImpl = fakeFetch({ status: 200 });
    const result = await verifyPostUrl('https://knowyourmeme.com/memes/x', 'TIKTOK', {
      fetchImpl,
      now,
    });

    expect(result.health).toBe('NOT_ORIGINAL');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('deriveVerificationState', () => {
  it('requires both a healthy link and trusted metrics to be VERIFIED', () => {
    expect(deriveVerificationState('OK', true)).toBe('VERIFIED');
    expect(deriveVerificationState('OK', false)).toBe('PARTIALLY_VERIFIED');
    expect(deriveVerificationState('REDIRECTED', true)).toBe('VERIFIED');
  });

  it('marks unreachable and unchecked links as UNVERIFIED', () => {
    expect(deriveVerificationState('UNREACHABLE', true)).toBe('UNVERIFIED');
    expect(deriveVerificationState('UNCHECKED', true)).toBe('UNVERIFIED');
    expect(deriveVerificationState('ACCESS_RESTRICTED', true)).toBe('UNVERIFIED');
  });

  it('rejects structurally wrong links outright', () => {
    expect(deriveVerificationState('NOT_ORIGINAL', true)).toBe('REJECTED');
    expect(deriveVerificationState('ACCOUNT_MISMATCH', true)).toBe('REJECTED');
  });
});
