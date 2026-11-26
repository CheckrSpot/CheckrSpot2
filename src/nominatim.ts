import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { AreaFinder, Bounds, Place, ReverseGeocoder } from './geocoder';

const SOURCE = 'nominatim';
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy requires an identifying User-Agent and at most one
// request per second across all users of the app.
const USER_AGENT = 'CheckrSpot/2.0';
const MIN_INTERVAL_MS = 1500;
const TIMEOUT_MS = 10000;

/** The request never got an answer (offline, timeout). */
class NetworkError extends Error {}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

interface NominatimResponse {
  error?: string;
  display_name?: string;
  address?: Record<string, string>;
  /** South, north, west, east, as strings. */
  boundingbox?: string[];
}

function toBounds(box: string[] | undefined): Bounds | null {
  const b = box?.map(Number);
  return b && b.length === 4 && b.every(Number.isFinite) ? [b[0], b[1], b[2], b[3]] : null;
}

// Undo formatRegion for a search: "US-AZ, Pima Co." → "Pima County, US-AZ".
// Other text, such as a region the user typed, is searched as it is.
function regionQuery(region: string): string {
  const parts = region.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(parts[0])) parts.push(parts.shift()!);
  return parts.map((p) => p.replace(/\bCo\.$/, 'County')).join(', ');
}

// As in the old app: the ISO region code, then the first part of the display
// name (at zoom 9 usually the county) with "County" shortened to "Co.".
// "Pima County, Arizona, United States" + "US-AZ" → "US-AZ, Pima Co."
function formatRegion(data: NominatimResponse): string | null {
  const first = (data.display_name ?? '').split(',')[0].trim().replace(/County/g, 'Co.');
  const iso = data.address?.['ISO3166-2-lvl4'] ?? '';
  return [iso, first].filter(Boolean).join(', ') || null;
}

/** Reverse geocoding, and finding a region's area, with OpenStreetMap's Nominatim service. */
export class NominatimGeocoder implements ReverseGeocoder, AreaFinder {
  // Keyed by coordinates rounded to ~100 m, which is within GPS error. Holds
  // requests in progress too, so a repeat shares the first one's answer.
  private cache = new Map<string, Promise<Place>>();
  // Requests run one at a time, in order, spaced MIN_INTERVAL_MS apart.
  private tail: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  // Bumped when a request fails for lack of a network, which fails every
  // request queued before then instead of waiting out each one's timeout.
  private generation = 0;

  lookup(latitude: number, longitude: number): Promise<Place> {
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const place = this.enqueue(() => this.request(latitude, longitude));
    this.cache.set(key, place);
    // Don't remember failures; the next lookup tries again.
    place.catch(() => {
      if (this.cache.get(key) === place) this.cache.delete(key);
    });
    return place;
  }

  areaOf(place: Pick<Place, 'source' | 'details'>): Bounds | null {
    if (place.source !== SOURCE) return null;
    return toBounds((place.details as NominatimResponse | null)?.boundingbox);
  }

  findArea(region: string): Promise<Bounds | null> {
    return this.enqueue(async () => {
      const results = await this.get(SEARCH_ENDPOINT, {
        format: 'jsonv2',
        q: regionQuery(region),
        limit: '1',
        'accept-language': 'en',
      });
      return toBounds((results as NominatimResponse[])[0]?.boundingbox);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    const run = this.tail.then(async () => {
      if (generation !== this.generation) throw new NetworkError('No network connection');
      await wait(this.lastRequestAt + MIN_INTERVAL_MS - Date.now());
      try {
        return await task();
      } catch (err) {
        if (err instanceof NetworkError) this.generation++;
        throw err;
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }

  private async request(latitude: number, longitude: number): Promise<Place> {
    const data = (await this.get(ENDPOINT, {
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      zoom: '9',
      'accept-language': 'en',
    })) as NominatimResponse;
    // An `error` (e.g. "Unable to geocode" for open ocean) is an answer, not a failure.
    return { region: data.error ? null : formatRegion(data), source: SOURCE, details: data };
  }

  private async get(url: string, params: Record<string, string>): Promise<unknown> {
    let res;
    try {
      res = await CapacitorHttp.get({
        url,
        params,
        // Browsers don't let pages set User-Agent (and trying could trigger a
        // CORS preflight), so only send it natively.
        headers: Capacitor.isNativePlatform() ? { 'User-Agent': USER_AGENT } : {},
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS,
        responseType: 'json',
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : String(err));
    }
    if (res.status !== 200) throw new Error(`Nominatim returned HTTP ${res.status}`);
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }
}
