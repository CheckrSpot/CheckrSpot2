import type { Reading } from './db';
import { wallTime, zoneAt } from './time';

export type ExportFormat = 'json' | 'csv';

const pad = (n: number) => String(n).padStart(2, '0');

// Device-local date as `yyyy-mm-dd` and time as `hh:mm` (24-hour).
export function localDateTime(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// A reading's date and time (`hh:mm`), local to where it was taken. When that
// zone is unknown they are UTC, and the time ends in "Z".
export function formatReading(r: Reading): { date: string; time: string } {
  const zone = zoneAt(r.latitude, r.longitude);
  const { date, time } = wallTime(r.recordedAt, zone);
  return { date, time: zone ? time : `${time}Z` };
}

// ISO 8601 in the reading's local time with its UTC offset, to the minute
// (seconds are dropped, as everywhere outside the database), e.g.
// 2026-10-24T14:32-07:00.
function localTimestamp(r: Reading): string {
  const { date, time, offset } = wallTime(r.recordedAt, zoneAt(r.latitude, r.longitude));
  return `${date}T${time}${offset}`;
}

// Same precision as the editor and labels.
const coord = (x: number) => Number(x.toFixed(5));

// One object per reading; null fields are left out. `revGeocode` is the
// geocoding service's whole response (it carries the OSM licence notice).
export function toJSON(readings: Reading[]): string {
  const records = readings.map((r) => {
    const { date, time } = formatReading(r);
    const record: Record<string, unknown> = {
      id: r.code,
      timestamp: localTimestamp(r),
      date,
      time,
      latitude: coord(r.latitude),
      longitude: coord(r.longitude),
      accuracy: r.accuracy != null ? Math.round(r.accuracy) : null,
      altitude: r.altitude != null ? Math.round(r.altitude) : null,
      region: r.region,
      locality: r.locality,
      locality2: r.locality2,
      taxon: r.taxon,
      collector: r.collector,
      revGeocode: r.place?.details ?? null,
    };
    for (const key of Object.keys(record)) {
      if (record[key] == null) delete record[key];
    }
    return record;
  });
  return JSON.stringify(records, null, 2);
}

const CSV_COLUMNS = [
  'id',
  'date',
  'time',
  'latitude',
  'longitude',
  'accuracy_m',
  'altitude_m',
  'region',
  'locality',
  'locality2',
  'taxon',
  'collector',
];

// RFC 4180: quote fields containing a comma, quote or line break, doubling quotes.
function csvField(value: string | number | null): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(readings: Reading[]): string {
  const rows = readings.map((r) => {
    const { date, time } = formatReading(r);
    return [
      r.code,
      date,
      time,
      r.latitude.toFixed(5),
      r.longitude.toFixed(5),
      r.accuracy != null ? Math.round(r.accuracy) : null,
      r.altitude != null ? Math.round(r.altitude) : null,
      r.region,
      r.locality,
      r.locality2,
      r.taxon,
      r.collector,
    ].map(csvField);
  });
  return [CSV_COLUMNS, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}

// File name for a download, e.g. checkrspot-2026-10-25-1432.csv.
export function exportFilename(format: ExportFormat): string {
  const { date, time } = localDateTime(Date.now());
  return `checkrspot-${date}-${time.replace(':', '')}.${format}`;
}
