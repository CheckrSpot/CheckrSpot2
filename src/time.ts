import tzlookup from '@photostructure/tz-lookup';

// A reading's time is shown and edited as local time where it was taken,
// whatever zone the phone is in now: the zone comes from the reading's
// coordinates. Temporal does the zone arithmetic; initTime() loads a polyfill
// when the WebView lacks it. Without Temporal, or for a place whose zone isn't
// known, times are UTC and marked "Z".

const pad = (n: number) => String(n).padStart(2, '0');

/** Call once at startup, before any of the functions below. */
export async function initTime(): Promise<void> {
  if (typeof Temporal !== 'undefined') return;
  try {
    await import('temporal-polyfill/global');
  } catch (err) {
    console.warn('Temporal polyfill failed to load; showing times in UTC.', err);
  }
}

const hasTemporal = () => typeof Temporal !== 'undefined';

// Whether the WebView's Intl knows each zone: older ones lack recently added
// or renamed zones (e.g. Europe/Kyiv), which tz-lookup may return.
const zoneSupported = new Map<string, boolean>();

function supported(zone: string): boolean {
  let ok = zoneSupported.get(zone);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      ok = true;
    } catch {
      ok = false;
    }
    zoneSupported.set(zone, ok);
  }
  return ok;
}

/** The IANA time zone at a place, or null when it's unknown (times are then UTC). */
export function zoneAt(latitude: number, longitude: number): string | null {
  if (!hasTemporal()) return null;
  try {
    const zone = tzlookup(latitude, longitude);
    return supported(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** A moment as wall-clock time in some zone. */
export interface WallTime {
  /** `yyyy-mm-dd`. */
  date: string;
  /** `hh:mm`, 24-hour. */
  time: string;
  /** The seconds and milliseconds past the minute, in ms. Kept, never shown. */
  subMinute: number;
  /** UTC offset, e.g. `-07:00`; `Z` for UTC. */
  offset: string;
}

export function wallTime(ms: number, zone: string | null): WallTime {
  // Kept exactly, fraction included: iOS fix timestamps can have fractional
  // milliseconds, which Temporal rejects.
  const subMinute = ms - Math.floor(ms / 60000) * 60000;
  if (zone && hasTemporal()) {
    const z = Temporal.Instant.fromEpochMilliseconds(Math.floor(ms)).toZonedDateTimeISO(zone);
    return {
      date: z.toPlainDate().toString(),
      time: `${pad(z.hour)}:${pad(z.minute)}`,
      subMinute,
      offset: z.offset,
    };
  }
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), subMinute, offset: 'Z' };
}

/** Year, month, day, hour and minute from `yyyy-mm-dd` and `h:mm` text; null if invalid. */
export function parseWallTime(date: string, time: string): number[] | null {
  const d = date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const t = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) return null;
  const [y, mo, day, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  // Date.UTC rolls 2026-02-30 over into March; reject that.
  const check = new Date(Date.UTC(y, mo - 1, day));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) return null;
  if (h > 23 || mi > 59) return null;
  return [y, mo, day, h, mi];
}

/**
 * The epoch milliseconds for wall-clock `date` and `time` in `zone` (UTC when
 * null), plus `subMinute` ms. Null if the text isn't a valid date and time. A
 * time skipped or repeated by a daylight-saving change resolves as Date does.
 */
export function fromWallTime(
  date: string,
  time: string,
  subMinute: number,
  zone: string | null,
): number | null {
  const parts = parseWallTime(date, time);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts;
  if (zone && hasTemporal()) {
    const local = Temporal.PlainDateTime.from({ year, month, day, hour, minute });
    return local.toZonedDateTime(zone).epochMilliseconds + subMinute;
  }
  return Date.UTC(year, month - 1, day, hour, minute) + subMinute;
}

/** A short name for the zone at a moment, e.g. "MST" or "GMT+1"; "UTC" when null. */
export function zoneName(zone: string | null, ms: number): string {
  if (!zone) return 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(ms);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? zone;
}
