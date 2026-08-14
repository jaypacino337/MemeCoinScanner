/**
 * URL-backed filter state.
 *
 * Deliberately framework-neutral and free of 'use client': the radar pages are
 * server components that parse the incoming query string, while FilterBar is a
 * client component that writes it. Both need this logic, so it cannot live in
 * either one.
 */

export interface FilterState {
  windowDays: number;
  minViews: number;
  minLikes: number;
  minFollowers: number;
  category: string;
  screeningStatus: string;
  requireEnglishAudience: boolean;
  animalsOnly: boolean;
  catsAndDogsOnly: boolean;
  pfpFriendlyOnly: boolean;
  noCelebrityOrIpRisk: boolean;
  requireCleanPumpFun: boolean;
  signalStage: string;
}

export const FILTER_DEFAULTS: FilterState = {
  windowDays: 7,
  minViews: 3_000_000,
  minLikes: 0,
  minFollowers: 0,
  category: '',
  screeningStatus: '',
  requireEnglishAudience: true,
  animalsOnly: false,
  catsAndDogsOnly: false,
  pfpFriendlyOnly: false,
  noCelebrityOrIpRisk: false,
  requireCleanPumpFun: false,
  signalStage: 'any',
};

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): FilterState {
  const get = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const num = (key: string, fallback: number): number => {
    const raw = get(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const raw = get(key);
    if (raw === undefined) return fallback;
    return raw === 'true' || raw === '1';
  };

  return {
    windowDays: num('windowDays', FILTER_DEFAULTS.windowDays),
    minViews: num('minViews', FILTER_DEFAULTS.minViews),
    minLikes: num('minLikes', FILTER_DEFAULTS.minLikes),
    minFollowers: num('minFollowers', FILTER_DEFAULTS.minFollowers),
    category: get('category') ?? '',
    screeningStatus: get('screeningStatus') ?? '',
    requireEnglishAudience: bool('english', FILTER_DEFAULTS.requireEnglishAudience),
    animalsOnly: bool('animalsOnly', false),
    catsAndDogsOnly: bool('catsAndDogsOnly', false),
    pfpFriendlyOnly: bool('pfpOnly', false),
    noCelebrityOrIpRisk: bool('noIpRisk', false),
    requireCleanPumpFun: bool('cleanOnly', false),
    signalStage: get('stage') ?? 'any',
  };
}
