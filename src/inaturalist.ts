import { Capacitor, CapacitorHttp } from '@capacitor/core';

// The parts of iNaturalist's API (https://api.inaturalist.org/v1/docs/) that
// the taxon chooser uses: which taxa have been observed near a place at a
// time of year, and taxon search by name for the chooser's settings.

const API = 'https://api.inaturalist.org/v1';
const USER_AGENT = 'CheckrSpot/2.0';
const TIMEOUT_MS = 15000;
// The most the API returns in one page.
const MAX_RESULTS = 500;

/** A taxon with how many matching observations it has. */
export interface TaxonCount {
  id: number;
  /** Scientific name. */
  name: string;
  rank: string;
  /** 10 for species, 20 for genus, etc. */
  rankLevel: number;
  count: number;
  /** About 500 px on the long side; null when the taxon has no photo. */
  photoUrl: string | null;
}

/** A search result for the base-taxon setting. */
export interface TaxonSuggestion {
  id: number;
  name: string;
  rank: string;
  commonName: string | null;
}

interface ApiTaxon {
  id: number;
  name: string;
  rank: string;
  rank_level: number;
  preferred_common_name?: string;
  default_photo?: { medium_url?: string } | null;
}

async function get(path: string, params: Record<string, string>): Promise<unknown> {
  const res = await CapacitorHttp.get({
    url: `${API}${path}`,
    params,
    // Browsers don't let pages set User-Agent, so only send it natively.
    headers: Capacitor.isNativePlatform() ? { 'User-Agent': USER_AGENT } : {},
    connectTimeout: TIMEOUT_MS,
    readTimeout: TIMEOUT_MS,
    responseType: 'json',
  });
  if (res.status !== 200) throw new Error(`iNaturalist returned HTTP ${res.status}`);
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

export interface NearbyQuery {
  taxonId: number;
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** Weeks of the year (1–53), in any year; null for the whole year. */
  weeks: number[] | null;
}

// Answers for this session, keyed by query. Failures aren't kept.
const nearbyCache = new Map<string, Promise<TaxonCount[]>>();

/** Taxa observed within the query's radius and weeks, most observed first. */
export function nearbyTaxa(query: NearbyQuery): Promise<TaxonCount[]> {
  const params: Record<string, string> = {
    taxon_id: String(query.taxonId),
    lat: query.latitude.toFixed(4),
    lng: query.longitude.toFixed(4),
    radius: String(query.radiusKm),
    verifiable: 'true',
    per_page: String(MAX_RESULTS),
  };
  if (query.weeks) params.week = query.weeks.join(',');
  const key = JSON.stringify(params);
  let result = nearbyCache.get(key);
  if (!result) {
    result = get('/observations/species_counts', params).then((data) =>
      (data as { results: { count: number; taxon: ApiTaxon }[] }).results.map(({ count, taxon }) => ({
        id: taxon.id,
        name: taxon.name,
        rank: taxon.rank,
        rankLevel: taxon.rank_level,
        count,
        photoUrl: taxon.default_photo?.medium_url ?? null,
      })),
    );
    nearbyCache.set(key, result);
    result.catch(() => nearbyCache.delete(key));
  }
  return result;
}

/** Taxa whose names start with `text`, best matches first. */
export async function searchTaxa(text: string): Promise<TaxonSuggestion[]> {
  const data = await get('/taxa/autocomplete', { q: text, is_active: 'true', per_page: '10' });
  return (data as { results: ApiTaxon[] }).results.map((t) => ({
    id: t.id,
    name: t.name,
    rank: t.rank,
    commonName: t.preferred_common_name ?? null,
  }));
}

// ISO 8601 week number (1–53) of a calendar date.
export function isoWeek(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  // The Thursday of this week decides which year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - jan1) / 86400000 / 7) + 1;
}

/**
 * The weeks of the year from `before` weeks before `week` to `after` weeks
 * after it, wrapping around the new year; null if that covers the whole year.
 */
export function weeksAround(week: number, before: number, after: number): number[] | null {
  if (before + after + 1 >= 52) return null;
  const weeks = new Set<number>();
  for (let k = -before; k <= after; k++) weeks.add((((week - 1 + k) % 52) + 52) % 52 + 1);
  // Week 53 exists only in some years; include it whenever the window
  // reaches the turn of the year.
  if (weeks.has(52) || weeks.has(1) || week === 53) weeks.add(53);
  return [...weeks].sort((a, b) => a - b);
}
