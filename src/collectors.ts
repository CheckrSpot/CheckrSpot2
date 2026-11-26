// Every collector name ever saved with a reading, with a tally of how many
// times: each save (capture, import or editor) adds one, and nothing ever
// subtracts, so the tally is only a rough guide. Counts stop at MAX_COUNT, so
// among names that reach it the most recently used comes first. Kept in
// localStorage: losing it (the OS may clear web storage) only empties the
// collector chooser.

const KEY = 'collectors';
const MAX_COUNT = 100;

export interface Collector {
  name: string;
  count: number;
  /** When last saved (epoch ms), to break ties. */
  used: number;
}

function load(): Collector[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** All remembered collectors, most used first. */
export function collectors(): Collector[] {
  return load().sort((a, b) => b.count - a.count || b.used - a.used);
}

/** The most used collector, for a new reading; null if there are none. */
export const commonCollector = (): string | null => collectors()[0]?.name ?? null;

/** Count a reading saved with this collector (null or blank: none). */
export function countCollector(name: string | null) {
  name = name?.trim() || null;
  if (!name) return;
  const list = load();
  let c = list.find((x) => x.name === name);
  if (!c) {
    c = { name, count: 0, used: 0 };
    list.push(c);
  }
  c.count = Math.min(MAX_COUNT, c.count + 1);
  c.used = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not worth bothering the user about.
  }
}
