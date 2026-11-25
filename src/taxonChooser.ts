import {
  isoWeek,
  nearbyTaxa,
  searchTaxa,
  weeksAround,
  type TaxonCount,
  type TaxonSuggestion,
} from './inaturalist';
import { expand } from './motion';

// The editor's taxon chooser: a grid of the taxa observed on iNaturalist
// near the reading, at that time of year (in any year), most observed first.
// Tapping one picks its scientific name. The gear opens the settings: base
// taxon (searched by name), radius and ± weeks, remembered in
// localStorage.

export interface TaxonSettings {
  /** iNaturalist taxon id. */
  taxonId: number;
  /** Only for showing the setting. */
  taxonName: string;
  radiusKm: number;
  /** How many weeks before and after the reading's week of the year. */
  weeks: number;
}

const SETTINGS_KEY = 'taxonChooser';

const DEFAULTS: TaxonSettings = {
  taxonId: 47224,
  taxonName: 'Butterflies',
  radiusKm: 25,
  weeks: 3,
};

function loadSettings(): TaxonSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: TaxonSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not worth bothering the user about.
  }
}

// Wait this long after typing stops before searching for a base taxon, and
// after the last tap on a − / + button before loading the grid again.
const SEARCH_DELAY_MS = 300;
const STEP_DELAY_MS = 500;

// Limits of the number settings, and the values the radius buttons step
// through (one step size wouldn't suit both small and large radii).
const MAX_RADIUS_KM = 500;
const MAX_WEEKS = 26;
const RADIUS_STEPS = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500];

// A number setting with − and + buttons either side of its field.
const stepper = (id: string, label: string, inputmode: string, unit: string) => `
  <div class="setting">
    <label for="${id}">${label}</label>
    <span class="stepper">
      <button type="button" class="step-btn" data-for="${id}" data-step="-1"
        aria-label="Less ${unit}">−</button>
      <input id="${id}" type="text" inputmode="${inputmode}" />
      <button type="button" class="step-btn" data-for="${id}" data-step="1"
        aria-label="More ${unit}">+</button>
    </span>
  </div>`;

/** The chooser's panel, for the editor's markup. */
export const TAXON_CHOOSER_MARKUP = `
  <section id="taxon-chooser" class="chooser tall" aria-label="Choose taxon">
    <header class="chooser-bar taxon-bar">
      <button id="taxon-cancel" type="button" class="text-btn">Cancel</button>
      <span id="taxon-summary" class="chooser-title"></span>
      <button id="taxon-gear" type="button" class="icon-btn gear-btn" aria-label="Settings"
        aria-expanded="false" aria-controls="taxon-settings">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
    <div id="taxon-settings" class="taxon-settings" hidden>
      <div class="settings-inner">
        <label>Base taxon
          <input id="taxon-base" type="text" autocapitalize="off" autocorrect="off"
            spellcheck="false" enterkeyhint="search" />
        </label>
        <ul id="taxon-suggestions" class="suggestions"></ul>
        <div class="settings-row">
          ${stepper('taxon-radius', 'Radius (km)', 'decimal', 'radius')}
          ${stepper('taxon-weeks', 'Weeks (±)', 'numeric', 'weeks')}
        </div>
      </div>
    </div>
    <div id="taxon-body" class="chooser-body taxon-body">
      <div id="taxon-status" class="taxon-status" hidden>
        <p id="taxon-message"></p>
        <button id="taxon-retry" type="button" class="secondary-btn" hidden>Retry</button>
      </div>
      <div id="taxon-grid" class="taxon-grid"></div>
    </div>
  </section>
`;

/** Where and when the reading is, for the query. */
export interface Spot {
  latitude: number;
  longitude: number;
  year: number;
  month: number;
  day: number;
}

export interface TaxonChooserHost {
  /** A taxon was tapped; `name` is its scientific name. */
  pick(name: string): void;
  cancel(): void;
}

/** Wire up the chooser's panel (already in the document, from TAXON_CHOOSER_MARKUP). */
export function createTaxonChooser(host: TaxonChooserHost): { begin(spot: Spot): void } {
  const q = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  const summaryEl = q<HTMLElement>('#taxon-summary');
  const gearBtn = q<HTMLButtonElement>('#taxon-gear');
  const settingsEl = q<HTMLElement>('#taxon-settings');
  const baseIn = q<HTMLInputElement>('#taxon-base');
  const suggestionsEl = q<HTMLUListElement>('#taxon-suggestions');
  const radiusIn = q<HTMLInputElement>('#taxon-radius');
  const weeksIn = q<HTMLInputElement>('#taxon-weeks');
  const bodyEl = q<HTMLElement>('#taxon-body');
  const statusEl = q<HTMLElement>('#taxon-status');
  const retryBtn = q<HTMLButtonElement>('#taxon-retry');
  const gridEl = q<HTMLElement>('#taxon-grid');

  let settings = loadSettings();
  let spot: Spot | null = null;
  // Each load is a run; an earlier run's results are dropped.
  let run = 0;

  const weeksText = (s: TaxonSettings) => (s.weeks * 2 + 1 >= 52 ? 'all year' : `±${s.weeks} wk`);

  function showSettings() {
    summaryEl.textContent = `${settings.taxonName} · ${settings.radiusKm} km · ${weeksText(settings)}`;
    baseIn.value = settings.taxonName;
    radiusIn.value = String(settings.radiusKm);
    weeksIn.value = String(settings.weeks);
    for (const btn of settingsEl.querySelectorAll<HTMLButtonElement>('.step-btn')) {
      const key = btn.dataset.for === 'taxon-radius' ? 'radiusKm' : 'weeks';
      btn.disabled = stepped(key, Number(btn.dataset.step)) === settings[key];
    }
  }

  let loadTimer: ReturnType<typeof setTimeout> | undefined;

  // Save and show the changed settings, and load the grid for them: at once,
  // or after a pause (for the − / + buttons, which are often tapped repeatedly).
  function update(changes: Partial<TaxonSettings>, later = false) {
    settings = { ...settings, ...changes };
    saveSettings(settings);
    showSettings();
    clearTimeout(loadTimer);
    if (later) loadTimer = setTimeout(load, STEP_DELAY_MS);
    else load();
  }

  // The value one step up (1) or down (-1) from the current one, within limits.
  function stepped(key: 'radiusKm' | 'weeks', direction: number): number {
    if (key === 'weeks') return Math.max(0, Math.min(MAX_WEEKS, settings.weeks + direction));
    const r = settings.radiusKm;
    const next =
      direction > 0
        ? RADIUS_STEPS.find((x) => x > r)
        : [...RADIUS_STEPS].reverse().find((x) => x < r);
    return next ?? r;
  }

  function showStatus(message: string | null, retry = false) {
    statusEl.hidden = message == null;
    q('#taxon-message').textContent = message ?? '';
    retryBtn.hidden = !retry;
  }

  // The count's font is a quarter of the tile's edge, so the tiles' size is
  // kept in --tile-size.
  function sizeTiles() {
    const thumb = gridEl.querySelector<HTMLElement>('.taxon-thumb');
    if (thumb) gridEl.style.setProperty('--tile-size', `${thumb.clientWidth}px`);
  }
  new ResizeObserver(sizeTiles).observe(gridEl);

  function tile(t: TaxonCount): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'taxon-tile';
    const thumb = document.createElement('span');
    thumb.className = 'taxon-thumb';
    if (t.photoUrl) {
      const img = document.createElement('img');
      img.src = t.photoUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumb.append(img);
    }
    const count = document.createElement('span');
    count.className = 'taxon-count';
    count.textContent = String(t.count);
    thumb.append(count);
    const name = document.createElement('span');
    // Genus and below are italic, as scientific names are written.
    name.className = t.rankLevel <= 20 ? 'taxon-name italic' : 'taxon-name';
    name.textContent = t.name;
    button.append(thumb, name);
    button.setAttribute('aria-label', `${t.name}, ${t.count} observations`);
    button.addEventListener('click', () => host.pick(t.name));
    return button;
  }

  async function load() {
    if (!spot) return;
    const thisRun = ++run;
    const s = settings;
    gridEl.replaceChildren();
    showStatus('Loading…');
    const weeks = weeksAround(isoWeek(spot.year, spot.month, spot.day), s.weeks, s.weeks);
    try {
      const taxa = await nearbyTaxa({
        taxonId: s.taxonId,
        latitude: spot.latitude,
        longitude: spot.longitude,
        radiusKm: s.radiusKm,
        weeks,
      });
      if (thisRun !== run) return;
      if (taxa.length === 0) {
        const when = weeks ? ' at this time of year' : '';
        showStatus(`No ${s.taxonName} observed within ${s.radiusKm} km${when}.`);
        return;
      }
      showStatus(null);
      gridEl.replaceChildren(...taxa.map(tile));
      bodyEl.scrollTop = 0;
      sizeTiles();
    } catch {
      if (thisRun === run) showStatus("Couldn't reach iNaturalist.", true);
    }
  }

  retryBtn.addEventListener('click', load);
  q('#taxon-cancel').addEventListener('click', host.cancel);

  function setSettingsOpen(open: boolean) {
    gearBtn.setAttribute('aria-expanded', String(open));
    expand(settingsEl, open);
    if (!open) {
      (document.activeElement as HTMLElement | null)?.blur();
      showSettings();
      suggestionsEl.replaceChildren();
    }
  }

  gearBtn.addEventListener('click', () => {
    setSettingsOpen(gearBtn.getAttribute('aria-expanded') !== 'true');
  });

  // Base taxon: search iNaturalist as the user types, and pick from the list.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchRun = 0;

  function suggestion(t: TaxonSuggestion): HTMLElement {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const main = document.createElement('span');
    main.textContent = t.commonName ?? t.name;
    const sub = document.createElement('span');
    sub.className = 'suggestion-sub';
    sub.textContent = `${t.rank} ${t.name}`;
    button.append(main, sub);
    button.addEventListener('click', () => {
      suggestionsEl.replaceChildren();
      baseIn.blur();
      update({ taxonId: t.id, taxonName: t.commonName ?? t.name });
    });
    li.append(button);
    return li;
  }

  baseIn.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const text = baseIn.value.trim();
    const thisSearch = ++searchRun;
    if (text.length < 2) {
      suggestionsEl.replaceChildren();
      return;
    }
    searchTimer = setTimeout(async () => {
      let found: TaxonSuggestion[];
      try {
        found = await searchTaxa(text);
      } catch {
        found = [];
      }
      if (thisSearch !== searchRun) return;
      suggestionsEl.replaceChildren(...found.map(suggestion));
    }, SEARCH_DELAY_MS);
  });

  // Keep the field focused while a suggestion is tapped, so the list stays put.
  suggestionsEl.addEventListener('mousedown', (e) => e.preventDefault());

  // Leaving the field without picking a suggestion keeps the current taxon.
  baseIn.addEventListener('blur', () => {
    searchRun++;
    clearTimeout(searchTimer);
    setTimeout(() => {
      if (document.activeElement === baseIn) return;
      suggestionsEl.replaceChildren();
      baseIn.value = settings.taxonName;
    }, 250);
  });

  // Radius and weeks apply when the field is left; invalid values are undone.
  const numberSetting = (
    el: HTMLInputElement,
    key: 'radiusKm' | 'weeks',
    valid: (n: number) => boolean,
  ) => {
    el.addEventListener('change', () => {
      const n = Number(el.value.trim().replace(',', '.'));
      if (valid(n) && n !== settings[key]) update({ [key]: n });
      else showSettings();
    });
  };
  numberSetting(radiusIn, 'radiusKm', (n) => n > 0 && n <= MAX_RADIUS_KM);
  numberSetting(weeksIn, 'weeks', (n) => Number.isInteger(n) && n >= 0 && n <= MAX_WEEKS);

  for (const btn of settingsEl.querySelectorAll<HTMLButtonElement>('.step-btn')) {
    const key = btn.dataset.for === 'taxon-radius' ? 'radiusKm' : 'weeks';
    btn.addEventListener('click', () => {
      update({ [key]: stepped(key, Number(btn.dataset.step)) }, true);
    });
  }

  // Return applies the field and dismisses the keyboard.
  settingsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    e.target.blur();
  });

  function begin(s: Spot) {
    spot = s;
    clearTimeout(loadTimer);
    settings = loadSettings();
    // Settings start out closed.
    gearBtn.setAttribute('aria-expanded', 'false');
    settingsEl.hidden = true;
    settingsEl.style.height = '';
    suggestionsEl.replaceChildren();
    showSettings();
    load();
  }

  return { begin };
}
