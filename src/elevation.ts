import { Capacitor, CapacitorHttp } from '@capacitor/core';

// Ground elevation at a spot, from Open-Meteo's elevation API
// (https://open-meteo.com/en/docs/elevation-api: Copernicus 90 m DEM, no
// key). Used for the altitude when the location chooser moves a pin.

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const USER_AGENT = 'CheckrSpot/2.0';
const TIMEOUT_MS = 15000;

/** Metres above sea level (0 at sea); rejects if the service can't be reached. */
export async function elevationAt(latitude: number, longitude: number): Promise<number> {
  const res = await CapacitorHttp.get({
    url: ENDPOINT,
    params: { latitude: latitude.toFixed(5), longitude: longitude.toFixed(5) },
    // Browsers don't let pages set User-Agent, so only send it natively.
    headers: Capacitor.isNativePlatform() ? { 'User-Agent': USER_AGENT } : {},
    connectTimeout: TIMEOUT_MS,
    readTimeout: TIMEOUT_MS,
    responseType: 'json',
  });
  if (res.status !== 200) throw new Error(`Open-Meteo returned HTTP ${res.status}`);
  const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as {
    elevation?: unknown[];
  };
  const metres = data.elevation?.[0];
  if (typeof metres !== 'number' || !Number.isFinite(metres)) throw new Error('No elevation');
  return metres;
}
