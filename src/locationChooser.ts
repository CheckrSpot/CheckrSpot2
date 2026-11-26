import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Bounds } from './geocoder';
import { reducedMotion } from './motion';

// The editor's location chooser: a map (MapLibre GL with OpenFreeMap's
// OpenStreetMap tiles) with a pin for the reading, dots for the other
// readings and one for the device. A tap moves the pin there and centres the
// map on it. The circle around the pin is always half the map's width, so
// zooming sets the accuracy: the circle's radius on the ground. Loaded only
// when first needed (MapLibre is large).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_ACCURACY_M = 25;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
// MapLibre's world is this many pixels wide at zoom 0.
const WORLD_PX = 512;
const MAX_ZOOM = 22;
// Zoom for showing the device's position when there's nothing better.
const DEVICE_ZOOM = 13;
const PAN_MS = 400;
const AREA_PADDING_PX = 24;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** How the map starts out. */
export interface LocationStart {
  /** The reading's coordinates; null if it has none yet. */
  pin: LatLng | null;
  /** Metres; null if unknown (DEFAULT_ACCURACY_M is used). */
  accuracy: number | null;
  /** Where to look when there's no pin: the reading's region, if known. */
  area(): Promise<Bounds | null>;
  /** The other readings, shown as dots. */
  others: LatLng[];
}

export interface LocationChooserHost {
  /** The pin was moved (`moved`), or zooming changed the accuracy (metres). */
  change(pin: LatLng, accuracy: number, moved: boolean): void;
  /** Follow the device's position (null when unknown); returns a function that stops. */
  watchPosition(listener: (position: LatLng | null) => void): () => void;
}

export interface LocationChooser {
  begin(start: LocationStart): void;
  end(): void;
}

type Points = FeatureCollection<Point>;

const points = (ps: LatLng[]): Points => ({
  type: 'FeatureCollection',
  features: ps.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
    properties: {},
  })),
});

const metresPerPixel = (latitude: number, zoom: number) =>
  (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) / (WORLD_PX * 2 ** zoom);

/** `wrap` holds `.location-map`, `.accuracy-circle` and `.map-status`. */
export function createLocationChooser(wrap: HTMLElement, host: LocationChooserHost): LocationChooser {
  const mapEl = wrap.querySelector<HTMLElement>('.location-map')!;
  const circleEl = wrap.querySelector<HTMLElement>('.accuracy-circle')!;
  const statusEl = wrap.querySelector<HTMLElement>('.map-status')!;

  // No tilting: the accuracy assumes the map is seen from straight above.
  const map = new maplibregl.Map({
    container: mapEl,
    style: STYLE_URL,
    center: [0, 20],
    zoom: 1,
    maxZoom: MAX_ZOOM,
    maxPitch: 0,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
  });

  // The compass, which turns the map back to north, shows only when rotated.
  map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }));
  map.on('rotate', () => wrap.classList.toggle('rotated', Math.abs(map.getBearing()) > 0.5));

  // Dot layers, filled in once the style has loaded.
  const data: Record<'others' | 'device', Points> = { others: points([]), device: points([]) };
  const setPoints = (id: 'others' | 'device', ps: LatLng[]) => {
    data[id] = points(ps);
    map.getSource<maplibregl.GeoJSONSource>(id)?.setData(data[id]);
  };

  map.on('load', () => {
    statusEl.hidden = true;
    map.addSource('others', { type: 'geojson', data: data.others });
    map.addLayer({
      id: 'others',
      type: 'circle',
      source: 'others',
      paint: {
        'circle-radius': 4,
        'circle-color': '#2563eb',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
    map.addSource('device', { type: 'geojson', data: data.device });
    map.addLayer({
      id: 'device',
      type: 'circle',
      source: 'device',
      paint: {
        'circle-radius': 7,
        'circle-color': '#007aff',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
  });

  map.on('error', (e) => {
    console.warn('Map error:', e.error);
    if (!map.loaded()) {
      statusEl.textContent = "Couldn't load the map.";
      statusEl.hidden = false;
    }
  });

  const marker = new maplibregl.Marker({ color: '#dc2626' });
  let pin: maplibregl.LngLat | null = null;

  // The circle's radius: a quarter of the map's width.
  const radiusPx = () => mapEl.clientWidth / 4;
  const accuracy = () => Math.round(radiusPx() * metresPerPixel(pin!.lat, map.getZoom()));
  const zoomFor = (metres: number, latitude: number) =>
    Math.max(0, Math.min(MAX_ZOOM, Math.log2((radiusPx() * metresPerPixel(latitude, 0)) / metres)));

  function placeCircle() {
    circleEl.hidden = pin == null;
    if (!pin) return;
    const { x, y } = map.project(pin);
    circleEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  function setPin(p: maplibregl.LngLat | null) {
    pin = p;
    if (p) marker.setLngLat(p).addTo(map);
    else marker.remove();
    placeCircle();
  }

  const report = (moved: boolean) => {
    if (pin) host.change({ latitude: pin.lat, longitude: pin.lng }, accuracy(), moved);
  };

  map.on('move', placeCircle);
  map.on('zoom', () => report(false));
  map.on('click', (e) => {
    setPin(e.lngLat);
    map.easeTo({ center: e.lngLat, duration: reducedMotion() ? 0 : PAN_MS });
    report(true);
  });

  new ResizeObserver(() => {
    map.resize();
    placeCircle();
  }).observe(mapEl);

  // Each begin() is a run, so a slow region search doesn't move a later map.
  let run = 0;
  let stopWatching: (() => void) | null = null;
  let device: LatLng | null = null;
  // Waiting for the device's position, to show it when nothing else is known.
  let awaitingDevice = false;

  const showDevice = () =>
    map.jumpTo({ center: [device!.longitude, device!.latitude], zoom: DEVICE_ZOOM, bearing: 0 });

  function begin(start: LocationStart) {
    const thisRun = ++run;
    map.resize();
    setPoints('others', start.others);
    awaitingDevice = false;
    stopWatching?.();
    stopWatching = host.watchPosition((p) => {
      device = p;
      setPoints('device', p ? [p] : []);
      if (p && awaitingDevice && thisRun === run) {
        awaitingDevice = false;
        showDevice();
      }
    });

    if (start.pin) {
      const p = new maplibregl.LngLat(start.pin.longitude, start.pin.latitude);
      setPin(p);
      const zoom = zoomFor(start.accuracy ?? DEFAULT_ACCURACY_M, p.lat);
      map.jumpTo({ center: p, zoom, bearing: 0 });
      report(false);
      return;
    }

    // No pin until a tap. Look at the region, else where the device is.
    setPin(null);
    map.jumpTo({ center: [0, 20], zoom: 1, bearing: 0 });
    start
      .area()
      .catch(() => null)
      .then((bounds) => {
        if (thisRun !== run) return;
        if (bounds) {
          const [south, north, west, east] = bounds;
          const box: maplibregl.LngLatBoundsLike = [[west, south], [east, north]];
          map.fitBounds(box, { padding: AREA_PADDING_PX, duration: 0 });
        } else if (device) {
          showDevice();
        } else {
          awaitingDevice = true;
        }
      });
  }

  function end() {
    run++;
    awaitingDevice = false;
    stopWatching?.();
    stopWatching = null;
  }

  return { begin, end };
}
