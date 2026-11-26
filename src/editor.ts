import 'cally';
import { Clipboard } from '@capacitor/clipboard';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { collectors } from './collectors';
import { MAX_CODE_LENGTH, type Reading } from './db';
import type { Bounds, Place } from './geocoder';
import type { LatLng, LocationChooser, LocationChooserHost } from './locationChooser';
import { elevationAt } from './elevation';
import { afterSlide, reducedMotion } from './motion';
import { createTaxonChooser, TAXON_CHOOSER_MARKUP } from './taxonChooser';
import { fromWallTime, parseWallTime, wallTime, zoneAt, zoneName } from './time';

// The reading editor: a full-screen view that slides in from the right, with
// every field editable as text. Fields with a richer editor (a "chooser")
// are grouped under a Choose button. Choosing collapses the other groups,
// leaving that group at the top, and slides the chooser up from the bottom;
// the group's fields then follow the chooser, read-only, until it is done
// (keep) or cancelled (restore). The date and time and collector choosers
// are here; the taxon and location choosers are in taxonChooser.ts and
// locationChooser.ts.
// Swipe in from the left edge, or Cancel, to close the editor.

/** What the editor needs from the app. */
export interface EditorHost {
  /** Look up the reading's region and save it; resolves with the updated reading. */
  lookUpPlace(r: Reading): Promise<Reading>;
  /** The place at a spot, from the same service, without saving it. */
  placeAt(latitude: number, longitude: number): Promise<Place>;
  /** A region's area for the map: from its place's details, else by searching its text. */
  regionArea(region: string, place: Reading['place']): Promise<Bounds | null>;
  /** All readings, shown as dots on the map. */
  readings(): Reading[];
  /** Follow the device's position, shown on the map. */
  watchPosition: LocationChooserHost['watchPosition'];
  /** Save the edited reading (and refresh the list). */
  save(r: Reading): Promise<void>;
}

// How close to the left edge a swipe must start, and how far (as a fraction
// of the width) or fast (px/ms) it must go, to close the editor.
const EDGE_PX = 24;
const CLOSE_DISTANCE = 0.35;
const CLOSE_VELOCITY = 0.5;

const pad = (n: number) => String(n).padStart(2, '0');

// One collapsible group of fields. The outer element's height animates; the
// card inside it keeps its padding, so its height can be measured.
const group = (name: string, title: string | null, content: string, chooser = false) => `
  <div class="field-group" data-group="${name}">
    <div class="group-card">
      ${
        title
          ? `<div class="group-head">
              <span class="group-title">${title}</span>
              ${chooser ? `<button type="button" class="text-btn choose-btn">Choose</button>` : ''}
            </div>`
          : ''
      }
      ${content}
    </div>
  </div>`;

const MARKUP = `
  <dialog id="editor" class="screen" aria-labelledby="editor-title">
    <header class="sheet-bar">
      <button id="editor-cancel" type="button" class="text-btn">Cancel</button>
      <h2 id="editor-title"></h2>
      <button id="editor-save" type="button" class="text-btn">Save</button>
    </header>
    <form class="editor-body" novalidate>
      ${group(
        'code',
        null,
        `<label>ID<input id="ed-code" type="text" maxlength="${MAX_CODE_LENGTH}"
          autocapitalize="off" autocorrect="off" spellcheck="false" /></label>`,
      )}
      ${group(
        'taxon',
        'Taxon',
        `<input id="ed-taxon" type="text" autocapitalize="sentences" autocorrect="off"
          spellcheck="false" aria-label="Taxon" />`,
        true,
      )}
      ${group(
        'when',
        'Date and time <span id="ed-zone" class="zone"></span>',
        `<div class="field-row">
          <input id="ed-date" type="text" placeholder="yyyy-mm-dd" aria-label="Date"
            autocorrect="off" spellcheck="false" />
          <input id="ed-time" type="text" placeholder="hh:mm" aria-label="Time"
            autocorrect="off" spellcheck="false" />
        </div>`,
        true,
      )}
      ${group(
        'where',
        'Location',
        `<div class="field-row">
          <label>Latitude<input id="ed-lat" type="text" autocorrect="off" spellcheck="false" /></label>
          <label>Longitude<input id="ed-lng" type="text" autocorrect="off" spellcheck="false" /></label>
        </div>
        <label>Region<input id="ed-region" type="text" autocapitalize="words"
          autocorrect="off" spellcheck="false" /></label>
        <div class="field-row copy-row">
          <label>Accuracy (m)<input id="ed-acc" type="text" inputmode="decimal"
            placeholder="Unknown" /></label>
          <label>Altitude (m)<input id="ed-alt" type="text" autocorrect="off"
            spellcheck="false" placeholder="Unknown" /></label>
          <button id="ed-copy" type="button" class="secondary-btn copy-btn"
            aria-label="Copy latitude and longitude">Copy</button>
        </div>`,
        true,
      )}
      ${group(
        'locality',
        null,
        `<label>Locality
          <input id="ed-locality" type="text" autocapitalize="sentences" />
          <input id="ed-locality2" type="text" autocapitalize="sentences"
            aria-label="Locality, second line" />
        </label>`,
      )}
      ${group(
        'collector',
        'Collector',
        `<input id="ed-collector" type="text" autocapitalize="words" autocorrect="off"
          spellcheck="false" aria-label="Collector" />`,
        true,
      )}
    </form>
    <section id="when-chooser" class="chooser" aria-label="Choose date and time">
      <header class="chooser-bar">
        <button id="when-cancel" type="button" class="text-btn">Cancel</button>
        <button id="when-done" type="button" class="text-btn">Done</button>
      </header>
      <div class="chooser-body">
        <calendar-date id="ed-calendar" class="calendar" first-day-of-week="0">
          <svg slot="previous" class="icon" viewBox="0 0 24 24" aria-label="Previous month">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <svg slot="next" class="icon" viewBox="0 0 24 24" aria-label="Next month">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <calendar-month></calendar-month>
        </calendar-date>
        <div class="wheels">
          <div id="ed-hours" class="wheel" aria-label="Hour"></div>
          <span class="wheel-colon" aria-hidden="true">:</span>
          <div id="ed-minutes" class="wheel" aria-label="Minute"></div>
        </div>
      </div>
    </section>
    ${TAXON_CHOOSER_MARKUP}
    <section id="collector-chooser" class="chooser" aria-label="Choose collector">
      <header class="chooser-bar titled-bar">
        <button id="collector-cancel" type="button" class="text-btn">Cancel</button>
        <span class="chooser-title">Collectors</span>
        <span></span>
      </header>
      <div class="chooser-body collector-body">
        <p id="collector-empty" class="collector-empty" hidden>
          Collectors appear here once readings are saved with them.
        </p>
        <ul id="collector-list" class="collector-list"></ul>
      </div>
    </section>
    <section id="where-chooser" class="chooser tall" aria-label="Choose location">
      <header class="chooser-bar titled-bar">
        <button id="where-cancel" type="button" class="text-btn">Cancel</button>
        <span class="chooser-title">Tap to place the pin</span>
        <button id="where-done" type="button" class="text-btn">Done</button>
      </header>
      <div id="where-map" class="map-wrap">
        <div class="location-map"></div>
        <div class="accuracy-circle" hidden></div>
        <p class="map-status">Loading map…</p>
      </div>
    </section>
  </dialog>
  <dialog id="confirm-discard" class="inspector" aria-labelledby="discard-title">
    <h2 id="discard-title">Discard changes?</h2>
    <form method="dialog" class="dialog-actions">
      <button type="submit" value="keep" class="secondary-btn">Keep editing</button>
      <button type="submit" value="discard" class="danger-btn">Discard</button>
    </form>
  </dialog>
`;

/** A scrolling column of numbers that snaps to one, like an iOS picker wheel. */
interface Wheel {
  value: number;
  /** Scroll to `value`; call while the wheel is laid out. */
  show(value: number): void;
}

function makeWheel(el: HTMLElement, count: number, onChange: (value: number) => void): Wheel {
  const items = Array.from({ length: count }, (_, i) => {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.textContent = pad(i);
    item.addEventListener('click', () => {
      el.scrollTo({ top: i * item.offsetHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    return item;
  });
  // One empty row above and below, so the first and last numbers can reach the middle.
  const spacer = () => {
    const div = document.createElement('div');
    div.className = 'wheel-item';
    return div;
  };
  el.append(spacer(), ...items, spacer());
  const wheel: Wheel = {
    value: 0,
    show(value) {
      wheel.value = value;
      el.scrollTop = value * items[0].offsetHeight;
      highlight();
    },
  };
  const highlight = () => items.forEach((item, i) => item.classList.toggle('current', i === wheel.value));
  el.addEventListener('scroll', () => {
    const i = Math.round(el.scrollTop / items[0].offsetHeight);
    const value = Math.max(0, Math.min(count - 1, i));
    if (value === wheel.value) return;
    wheel.value = value;
    highlight();
    onChange(value);
  });
  return wheel;
}

export function createEditor(host: EditorHost): { open(r: Reading): void } {
  document.querySelector('#app')!.insertAdjacentHTML('beforeend', MARKUP);
  const q = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  const editorEl = q<HTMLDialogElement>('#editor');
  const discardEl = q<HTMLDialogElement>('#confirm-discard');
  const form = q<HTMLFormElement>('.editor-body');
  const cancelBtn = q<HTMLButtonElement>('#editor-cancel');
  const saveBtn = q<HTMLButtonElement>('#editor-save');
  const input = (id: string) => q<HTMLInputElement>(`#ed-${id}`);
  const codeIn = input('code');
  const taxonIn = input('taxon');
  const dateIn = input('date');
  const timeIn = input('time');
  const latIn = input('lat');
  const lngIn = input('lng');
  const accIn = input('acc');
  const altIn = input('alt');
  const regionIn = input('region');
  const localityIn = input('locality');
  const locality2In = input('locality2');
  const collectorIn = input('collector');
  const inputs = [...form.querySelectorAll('input')];
  const groups = [...form.querySelectorAll<HTMLElement>('.field-group')];
  const whenGroup = q<HTMLElement>('[data-group="when"]');
  const taxonGroup = q<HTMLElement>('[data-group="taxon"]');
  const whereGroup = q<HTMLElement>('[data-group="where"]');
  const copyBtn = q<HTMLButtonElement>('#ed-copy');
  const calendar = q<HTMLElement & { value: string; focusedDate?: string }>('#ed-calendar');

  // The reading being edited, as saved (its region is filled in if a lookup
  // finishes while the editor is open), and each field's value as first shown.
  let original: Reading | null = null;
  const initial = new Map<HTMLInputElement, string>();
  const changed = (el: HTMLInputElement) => el.value !== initial.get(el);
  const dirty = () => inputs.some(changed);

  /** A rich editor for one group's fields. */
  interface Chooser {
    group: HTMLElement;
    /** Slides up from the bottom. */
    panel: HTMLElement;
    /** The fields it fills in, which Cancel restores. */
    fields: HTMLInputElement[];
    /** Set the chooser up from the fields; called once its panel is open. */
    begin(): void;
    /** Called as it closes, done or cancelled. */
    end?(): void;
  }

  // The open chooser, and its fields' values from before it opened.
  let active: Chooser | null = null;
  let beforeChoosing: string[] = [];

  function updateSave() {
    saveBtn.disabled = active !== null || !dirty();
  }

  // The region looked up for the last pin placed in the location chooser,
  // with the coordinates (as text) it was looked up for. Each pin's lookups
  // (region and altitude) are a run; an older one's answers are dropped.
  let pinPlace: { latitude: string; longitude: string; place: Place } | null = null;
  let placeRun = 0;

  // Copy the coordinates as "lat, lng", which map apps accept as a search.
  function updateCopy() {
    copyBtn.disabled = !latIn.value.trim() || !lngIn.value.trim();
  }

  copyBtn.addEventListener('click', async () => {
    try {
      await Clipboard.write({ string: `${latIn.value.trim()}, ${lngIn.value.trim()}` });
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Not copied: ${msg}`);
    }
  });

  // The coordinates as typed, or the saved ones if they aren't numbers.
  function typedCoords(): [number, number] {
    const lat = Number(latIn.value);
    const lng = Number(lngIn.value);
    return latIn.value.trim() && lngIn.value.trim() && Number.isFinite(lat) && Number.isFinite(lng)
      ? [lat, lng]
      : [original!.latitude, original!.longitude];
  }

  // The zone the date and time are in, from the coordinates as typed.
  function updateZone() {
    if (!original) return;
    const zone = zoneAt(...typedCoords());
    const at = fromWallTime(dateIn.value, timeIn.value, 0, zone) ?? original.recordedAt;
    q('#ed-zone').textContent = zoneName(zone, at);
  }

  function open(r: Reading) {
    original = r;
    const { date, time } = wallTime(r.recordedAt, zoneAt(r.latitude, r.longitude));
    codeIn.value = r.code;
    taxonIn.value = r.taxon ?? '';
    dateIn.value = date;
    timeIn.value = time;
    latIn.value = r.latitude.toFixed(5);
    lngIn.value = r.longitude.toFixed(5);
    accIn.value = r.accuracy != null ? r.accuracy.toFixed(0) : '';
    altIn.value = r.altitude != null ? r.altitude.toFixed(0) : '';
    regionIn.value = r.region ?? '';
    localityIn.value = r.locality ?? '';
    locality2In.value = r.locality2 ?? '';
    collectorIn.value = r.collector ?? '';
    for (const el of inputs) initial.set(el, el.value);
    q('#editor-title').textContent = r.code || 'Reading';
    pinPlace = null;
    placeRun++;
    regionIn.placeholder = '';
    altIn.placeholder = 'Unknown';
    if (!r.place) {
      regionIn.placeholder = 'Looking up…';
      host.lookUpPlace(r).then(
        (u) => {
          if (original?.id !== u.id) return;
          original = { ...original, region: u.region, place: u.place };
          // Unless the user has started typing a region of their own.
          if (!changed(regionIn)) {
            regionIn.value = u.region ?? '';
            initial.set(regionIn, regionIn.value);
          }
          regionIn.placeholder = '';
          updateSave();
        },
        () => {
          if (original?.id === r.id) regionIn.placeholder = '';
        },
      );
    }
    updateZone();
    updateSave();
    updateCopy();
    form.scrollTop = 0;
    editorEl.showModal();
    // Start from off-screen, so adding .shown slides the editor in.
    void editorEl.offsetWidth;
    editorEl.classList.add('shown');
  }

  // Slide out, then close (unless it has been opened again meanwhile).
  function slideOut() {
    editorEl.classList.remove('shown');
    afterSlide(() => {
      if (!editorEl.classList.contains('shown')) editorEl.close();
    });
  }

  function confirmDiscard(): Promise<boolean> {
    discardEl.returnValue = '';
    discardEl.showModal();
    return new Promise((resolve) => {
      discardEl.addEventListener('close', () => resolve(discardEl.returnValue === 'discard'), {
        once: true,
      });
    });
  }

  async function requestClose() {
    if (active) {
      endChoosing(false);
      return;
    }
    if (dirty() && !(await confirmDiscard())) return;
    slideOut();
  }

  editorEl.addEventListener('close', () => {
    editorEl.classList.remove('shown');
    endChoosing(false);
    original = null;
  });

  // Escape, and Android's back gesture.
  editorEl.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });

  cancelBtn.addEventListener('click', requestClose);
  saveBtn.addEventListener('click', save);
  form.addEventListener('input', () => {
    updateSave();
    updateZone();
    updateCopy();
  });

  // Return moves to the next field; on the last one it dismisses the keyboard.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else e.target.blur();
  });

  // The edited reading, or null (after telling the user) if a field is invalid.
  function readForm(r: Reading): Reading | null {
    const fail = (el: HTMLInputElement, message: string) => {
      alert(message);
      el.focus();
      return null;
    };
    const text = (el: HTMLInputElement) => el.value.trim() || null;
    // A field left as shown keeps the stored value, which has more precision
    // than the text. Blank is null; NaN means it isn't a number.
    const number = (el: HTMLInputElement, stored: number | null) => {
      if (!changed(el)) return stored;
      const s = el.value.trim().replace(',', '.').replace(/°$/, '');
      return s === '' ? null : Number(s);
    };

    const latitude = number(latIn, r.latitude);
    if (latitude == null || !(Math.abs(latitude) <= 90)) {
      return fail(latIn, 'Latitude must be a number from -90 to 90.');
    }
    const longitude = number(lngIn, r.longitude);
    if (longitude == null || !(Math.abs(longitude) <= 180)) {
      return fail(lngIn, 'Longitude must be a number from -180 to 180.');
    }
    const accuracy = number(accIn, r.accuracy);
    if (accuracy != null && !(accuracy >= 0)) {
      return fail(accIn, 'Accuracy must be a number of metres, or blank.');
    }
    const altitude = number(altIn, r.altitude);
    if (altitude != null && Number.isNaN(altitude)) {
      return fail(altIn, 'Altitude must be a number of metres, or blank.');
    }
    const moved = latitude !== r.latitude || longitude !== r.longitude;

    // The date and time are local to the (possibly new) location, so moving a
    // reading keeps its wall-clock time. Seconds are kept unless the time
    // itself was changed.
    let recordedAt = r.recordedAt;
    if (changed(dateIn) || changed(timeIn) || moved) {
      const seconds = changed(timeIn)
        ? 0
        : wallTime(r.recordedAt, zoneAt(r.latitude, r.longitude)).subMinute;
      const t = fromWallTime(dateIn.value, timeIn.value, seconds, zoneAt(latitude, longitude));
      if (t == null) {
        const badDate = parseWallTime(dateIn.value, '00:00') == null;
        return fail(
          badDate ? dateIn : timeIn,
          'Enter the date as yyyy-mm-dd and the time as hh:mm (24-hour).',
        );
      }
      recordedAt = t;
    }

    // The region looked up for a pin is saved like any looked-up region. A
    // typed region is kept as a manual place, which lookups leave alone;
    // clearing it means "look it up again". Moving the reading drops a
    // looked-up region, which no longer applies.
    let { region, place } = r;
    const kept = pinPlace;
    const pinned =
      kept && kept.latitude === latIn.value && kept.longitude === lngIn.value
        ? kept.place
        : null;
    if (moved && pinned && text(regionIn) === pinned.region) {
      // Looked up for the pin placed in the location chooser.
      region = pinned.region;
      place = { source: pinned.source, details: pinned.details };
    } else if (changed(regionIn)) {
      region = text(regionIn);
      place = region ? { source: 'manual', details: null } : null;
    } else if (moved && place?.source !== 'manual') {
      region = null;
      place = null;
    }

    return {
      ...r,
      code: codeIn.value.trim(),
      latitude,
      longitude,
      accuracy,
      altitude,
      recordedAt,
      region,
      place,
      locality: text(localityIn),
      locality2: text(locality2In),
      taxon: text(taxonIn),
      collector: text(collectorIn),
    };
  }

  async function save() {
    if (!original) return;
    const updated = readForm(original);
    if (!updated) return;
    saveBtn.disabled = true;
    try {
      await host.save(updated);
      slideOut();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Changes not saved: ${msg}`);
      updateSave();
    }
  }

  // Collapse every group but `keep` (or expand them again), animating each
  // one's height between its natural height and zero.
  function collapseGroups(keep: HTMLElement, collapse: boolean) {
    for (const g of groups) {
      if (g === keep) continue;
      if (collapse) {
        g.style.height = `${g.offsetHeight}px`;
        void g.offsetHeight;
        g.classList.add('collapsed');
        g.style.height = '0px';
      } else {
        g.classList.remove('collapsed');
        g.style.height = `${g.scrollHeight}px`;
        afterSlide(() => {
          if (!g.classList.contains('collapsed')) g.style.height = '';
        });
      }
    }
  }

  function startChoosing(c: Chooser) {
    if (!original || active) return;
    active = c;
    beforeChoosing = c.fields.map((el) => el.value);
    (document.activeElement as HTMLElement | null)?.blur();
    for (const el of inputs) el.readOnly = true;
    cancelBtn.disabled = true;
    updateSave();
    form.classList.add('choosing');
    // Keep the chooser below the group, which ends up at the top.
    const top = form.offsetTop + c.group.offsetHeight + 24;
    editorEl.style.setProperty('--chooser-top', `${top}px`);
    collapseGroups(c.group, true);
    form.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    c.panel.classList.add('open');
    c.begin();
  }

  // Close the chooser, keeping its values or restoring the fields.
  function endChoosing(keep: boolean) {
    const c = active;
    if (!c) return;
    c.end?.();
    if (!keep) {
      c.fields.forEach((el, i) => (el.value = beforeChoosing[i]));
      placeRun++;
      regionIn.placeholder = '';
      altIn.placeholder = 'Unknown';
    }
    active = null;
    c.panel.classList.remove('open');
    form.classList.remove('choosing');
    collapseGroups(c.group, false);
    for (const el of inputs) el.readOnly = false;
    cancelBtn.disabled = false;
    updateZone();
    updateSave();
    updateCopy();
  }

  // The date and time chooser: Cally's calendar and two wheels.
  const setTime = () => {
    timeIn.value = `${pad(hours.value)}:${pad(minutes.value)}`;
    updateZone();
  };
  const hours = makeWheel(q('#ed-hours'), 24, setTime);
  const minutes = makeWheel(q('#ed-minutes'), 60, setTime);
  calendar.addEventListener('change', () => {
    dateIn.value = calendar.value;
    updateZone();
  });

  // The date and time as typed, or the saved ones if they don't parse.
  function typedWallTime(): number[] {
    const r = original!;
    const parts = parseWallTime(dateIn.value, timeIn.value);
    if (parts) return parts;
    const w = wallTime(r.recordedAt, zoneAt(r.latitude, r.longitude));
    return parseWallTime(w.date, w.time)!;
  }

  const whenChooser: Chooser = {
    group: whenGroup,
    panel: q('#when-chooser'),
    fields: [dateIn, timeIn],
    begin() {
      // The fields now show what the chooser shows.
      const [y, mo, d, h, mi] = typedWallTime();
      const date = `${y}-${pad(mo)}-${pad(d)}`;
      calendar.value = date;
      calendar.focusedDate = date;
      dateIn.value = date;
      hours.show(h);
      minutes.show(mi);
      setTime();
    },
  };

  whenGroup.querySelector('.choose-btn')!.addEventListener('click', () => startChoosing(whenChooser));
  q('#when-cancel').addEventListener('click', () => endChoosing(false));
  q('#when-done').addEventListener('click', () => endChoosing(true));

  // The taxon chooser queries iNaturalist for the place and date as typed.
  const taxonPicker = createTaxonChooser({
    pick(name) {
      taxonIn.value = name;
      endChoosing(true);
    },
    cancel: () => endChoosing(false),
  });

  const taxonChooser: Chooser = {
    group: taxonGroup,
    panel: q('#taxon-chooser'),
    fields: [taxonIn],
    begin() {
      const [latitude, longitude] = typedCoords();
      const [year, month, day] = typedWallTime();
      taxonPicker.begin({ latitude, longitude, year, month, day });
    },
  };

  // The collector chooser: every collector saved so far, most used first.
  // Tapping one picks it.
  const collectorList = q<HTMLUListElement>('#collector-list');
  const collectorChooser: Chooser = {
    group: q('[data-group="collector"]'),
    panel: q('#collector-chooser'),
    fields: [collectorIn],
    begin() {
      const all = collectors();
      q<HTMLElement>('#collector-empty').hidden = all.length > 0;
      collectorList.replaceChildren(
        ...all.map(({ name, count }) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.classList.toggle('current', name === collectorIn.value.trim());
          const nameEl = document.createElement('span');
          nameEl.className = 'collector-name';
          nameEl.textContent = name;
          const countEl = document.createElement('span');
          countEl.className = 'collector-count';
          countEl.textContent = String(count);
          btn.append(nameEl, countEl);
          btn.addEventListener('click', () => {
            collectorIn.value = name;
            endChoosing(true);
          });
          li.append(btn);
          return li;
        }),
      );
      collectorList.scrollTop = 0;
    },
  };

  collectorChooser.group
    .querySelector('.choose-btn')!
    .addEventListener('click', () => startChoosing(collectorChooser));
  q('#collector-cancel').addEventListener('click', () => endChoosing(false));

  // The location chooser: a map, loaded the first time it's needed.
  let locationPicker: Promise<LocationChooser> | null = null;
  const mapWrap = q<HTMLElement>('#where-map');

  // The coordinates as typed, or null if they aren't valid.
  function typedPin(): LatLng | null {
    const latitude = Number(latIn.value.trim().replace(',', '.'));
    const longitude = Number(lngIn.value.trim().replace(',', '.'));
    if (!latIn.value.trim() || !lngIn.value.trim()) return null;
    if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
    return { latitude, longitude };
  }

  // Look up the region and altitude for a pin; they show in their fields.
  function lookUpPin(pin: LatLng) {
    const thisRun = ++placeRun;
    const latitude = latIn.value;
    const longitude = lngIn.value;
    regionIn.value = '';
    regionIn.placeholder = 'Looking up…';
    host.placeAt(pin.latitude, pin.longitude).then(
      (place) => {
        if (thisRun !== placeRun) return;
        regionIn.placeholder = '';
        pinPlace = { latitude, longitude, place };
        // Unless the user has typed a region since the chooser closed.
        if (active === whereChooser || regionIn.value === '') regionIn.value = place.region ?? '';
        updateSave();
      },
      () => {
        if (thisRun === placeRun) regionIn.placeholder = '';
      },
    );
    altIn.value = '';
    altIn.placeholder = 'Looking up…';
    elevationAt(pin.latitude, pin.longitude).then(
      (metres) => {
        if (thisRun !== placeRun) return;
        altIn.placeholder = 'Unknown';
        // Unless the user has typed an altitude since the chooser closed.
        if (active === whereChooser || altIn.value === '') altIn.value = metres.toFixed(0);
        updateSave();
      },
      () => {
        if (thisRun === placeRun) altIn.placeholder = 'Unknown';
      },
    );
  }

  const locationHost: LocationChooserHost = {
    change(pin, accuracy, moved) {
      latIn.value = pin.latitude.toFixed(5);
      lngIn.value = pin.longitude.toFixed(5);
      accIn.value = String(accuracy);
      if (moved) lookUpPin(pin);
      updateZone();
      updateCopy();
    },
    watchPosition: (listener) => host.watchPosition(listener),
  };

  const whereChooser: Chooser = {
    group: whereGroup,
    panel: q('#where-chooser'),
    fields: [latIn, lngIn, accIn, altIn, regionIn],
    begin() {
      const r = original!;
      const accuracy = Number(accIn.value.trim().replace(',', '.'));
      const regionText = regionIn.value.trim();
      const start = {
        pin: typedPin(),
        accuracy: accIn.value.trim() && accuracy > 0 ? accuracy : null,
        area: () =>
          regionText
            ? host.regionArea(regionText, changed(regionIn) ? null : r.place)
            : Promise.resolve(null),
        others: host
          .readings()
          .filter((x) => x.id !== r.id)
          .map((x) => ({ latitude: x.latitude, longitude: x.longitude })),
      };
      if (!locationPicker) {
        locationPicker = import('./locationChooser').then((m) =>
          m.createLocationChooser(mapWrap, locationHost),
        );
        // Try again next time if it couldn't be loaded.
        locationPicker.catch(() => {
          locationPicker = null;
          const status = mapWrap.querySelector<HTMLElement>('.map-status')!;
          status.textContent = "Couldn't load the map.";
          status.hidden = false;
        });
      }
      locationPicker.then((picker) => {
        if (active === whereChooser) picker.begin(start);
      }, () => {});
    },
    end() {
      locationPicker?.then((picker) => picker.end(), () => {});
    },
  };

  q('#where-cancel').addEventListener('click', () => endChoosing(false));
  q('#where-done').addEventListener('click', () => endChoosing(true));

  // Both choosers that need the network are greyed out without it.
  const taxonChooseBtn = taxonGroup.querySelector<HTMLButtonElement>('.choose-btn')!;
  const whereChooseBtn = whereGroup.querySelector<HTMLButtonElement>('.choose-btn')!;
  taxonChooseBtn.addEventListener('click', () => startChoosing(taxonChooser));
  whereChooseBtn.addEventListener('click', () => startChoosing(whereChooser));
  const showConnection = ({ connected }: ConnectionStatus) => {
    taxonChooseBtn.disabled = !connected;
    whereChooseBtn.disabled = !connected;
  };
  Network.getStatus().then(showConnection, () => {});
  Network.addListener('networkStatusChange', showConnection);

  // Swipe in from the left edge to close, as with iOS navigation. The editor
  // follows the finger; let go far or fast enough and it closes (asking
  // first if there are changes), otherwise it slides back.
  let drag: { x0: number; y0: number; t0: number; dx: number; horizontal: boolean | null } | null =
    null;

  editorEl.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      if (active || e.touches.length !== 1 || t.clientX > EDGE_PX) return;
      drag = { x0: t.clientX, y0: t.clientY, t0: e.timeStamp, dx: 0, horizontal: null };
    },
    { passive: true },
  );

  editorEl.addEventListener(
    'touchmove',
    (e) => {
      if (!drag) return;
      const t = e.touches[0];
      const dx = t.clientX - drag.x0;
      const dy = t.clientY - drag.y0;
      if (drag.horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.horizontal = Math.abs(dx) > Math.abs(dy);
        if (!drag.horizontal) {
          drag = null;
          return;
        }
        editorEl.classList.add('dragging');
      }
      e.preventDefault();
      drag.dx = Math.max(0, dx);
      editorEl.style.transform = `translateX(${drag.dx}px)`;
    },
    { passive: false },
  );

  const endDrag = (e: TouchEvent) => {
    const d = drag;
    drag = null;
    if (!d?.horizontal) return;
    // Back under the stylesheet's control: it slides back from here, or on
    // to closed.
    editorEl.classList.remove('dragging');
    editorEl.style.transform = '';
    const velocity = d.dx / Math.max(1, e.timeStamp - d.t0);
    if (d.dx > editorEl.offsetWidth * CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) requestClose();
  };
  editorEl.addEventListener('touchend', endDrag);
  editorEl.addEventListener('touchcancel', endDrag);

  return { open };
}
