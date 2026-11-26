import {COUNTRY_CENTROIDS, FEATURED_COUNTRIES, RADIO_MIRRORS, countryCodeToFlag} from '../constants';
import type {CountryItem, Station} from '../types';
import {classifyStation, latLonToMercator} from '../utils/geo';
import {getCachedStations, saveCachedStations} from './storage';

const ENV_PROXY = (import.meta.env.VITE_RADIO_PROXY_URL as string | undefined)?.trim().replace(/\/+$/, '') || '';
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

interface RawStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  votes?: number;
  clickcount?: number;
  codec?: string;
  bitrate?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
  lastcheckok?: number;
}

interface RawCountry {
  name?: string;
  iso_3166_1?: string;
  stationcount?: number;
}

function getEndpointCandidates(routeWithQuery: string): string[] {
  const clean = routeWithQuery.replace(/^\/+/, '');
  const urls: string[] = [];

  if (ENV_PROXY) {
    urls.push(`${ENV_PROXY}/${clean}`);
  } else if (import.meta.env.DEV) {
    urls.push(`/api/radio/${clean}`);
  }

  for (const mirror of RADIO_MIRRORS) {
    urls.push(`${mirror}/json/${clean}`);
  }

  return urls;
}

async function fetchJsonRotating<T>(routeWithQuery: string, timeoutMs = 8000): Promise<T> {
  const candidates = getEndpointCandidates(routeWithQuery);
  let lastError: unknown;

  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {Accept: 'application/json'},
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return (await response.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network unavailable');
}

export function hydrateStation(raw: RawStation): Station | null {
  const uuid = (raw.stationuuid || '').trim();
  const name = (raw.name || '').trim().replace(/\s+/g, ' ');
  const resolved = (raw.url_resolved || raw.url || '').trim();
  if (!uuid || !name || !resolved) return null;

  const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpsStream = resolved.startsWith('https://');
  const isHttpStream = resolved.startsWith('http://');
  if (!isHttpsStream && !isHttpStream) return null;
  if (isHttpsPage && !isHttpsStream) return null;

  const lat = typeof raw.geo_lat === 'number' && Number.isFinite(raw.geo_lat) ? raw.geo_lat : null;
  const lng = typeof raw.geo_long === 'number' && Number.isFinite(raw.geo_long) ? raw.geo_long : null;
  const mercator = lat !== null && lng !== null ? latLonToMercator(lat, lng) : null;

  const station: Station = {
    stationuuid: uuid,
    name,
    url: (raw.url || resolved).trim(),
    url_resolved: resolved,
    homepage: (raw.homepage || '').trim(),
    favicon: (raw.favicon || '').trim(),
    tags: (raw.tags || '').trim(),
    country: (raw.country || '').trim(),
    countrycode: (raw.countrycode || '').toUpperCase().trim(),
    state: (raw.state || '').trim(),
    language: (raw.language || '').trim(),
    votes: Number(raw.votes) || 0,
    clickcount: Number(raw.clickcount) || 0,
    codec: (raw.codec || '').toUpperCase().trim(),
    bitrate: Number(raw.bitrate) || 0,
    geo_lat: lat,
    geo_long: lng,
    lastcheckok: Number(raw.lastcheckok) || 0,
    mx: mercator?.mx,
    my: mercator?.my,
  };

  station.category = classifyStation(station);
  return station;
}

function normalizeAndSortStations(rawList: RawStation[]): Station[] {
  const seenUrls = new Set<string>();
  const httpsList: Station[] = [];
  const httpFallbackList: Station[] = [];

  for (const item of rawList) {
    if (item.lastcheckok !== undefined && Number(item.lastcheckok) !== 1) continue;
    const station = hydrateStation(item);
    if (!station) continue;
    if (seenUrls.has(station.url_resolved)) continue;
    seenUrls.add(station.url_resolved);

    if (station.url_resolved.startsWith('https://')) {
      httpsList.push(station);
    } else {
      httpFallbackList.push(station);
    }
  }

  const score = (s: Station) => s.clickcount + s.votes * 2;
  httpsList.sort((a, b) => score(b) - score(a));
  httpFallbackList.sort((a, b) => score(b) - score(a));

  return httpsList.length >= 10 ? httpsList.slice(0, 500) : [...httpsList, ...httpFallbackList].slice(0, 500);
}

export interface LoadStationsResult {
  stations: Station[];
  source: 'online' | 'recent-cache' | 'offline-needed' | 'offline-backup';
}

export async function loadCountryStationsOnlineFirst(countryCode: string): Promise<LoadStationsResult> {
  const cc = countryCode.toUpperCase();
  const route = `stations/bycountrycodeexact/${cc}?hidebroken=true&order=clickcount&reverse=true&limit=700`;

  try {
    const raw = await fetchJsonRotating<RawStation[]>(route, 9000);
    if (Array.isArray(raw) && raw.length > 0) {
      const stations = normalizeAndSortStations(raw);
      if (stations.length > 0) {
        saveCachedStations(cc, stations);
        return {stations, source: 'online'};
      }
    }
  } catch {
    // Fall through to cache check
  }

  const cached = getCachedStations(cc);
  if (cached && cached.isFresh) {
    const hydrated = cached.payload.stations
      .map((s) => hydrateStation(s))
      .filter((s): s is Station => s !== null);
    if (hydrated.length > 0) {
      return {stations: hydrated, source: 'recent-cache'};
    }
  }

  return {stations: [], source: 'offline-needed'};
}

export async function loadOfflineBackupStations(countryCode: string): Promise<Station[]> {
  const cc = countryCode.toUpperCase();
  // First check stale localStorage cache for the requested country
  const cached = getCachedStations(cc);
  if (cached && cached.payload.stations.length > 0) {
    const hydrated = cached.payload.stations
      .map((s) => hydrateStation(s))
      .filter((s): s is Station => s !== null);
    if (hydrated.length > 0) return hydrated;
  }

  // Fallback to static bundled snapshot (public/data/stations-es.json)
  try {
    const res = await fetch(`${BASE_URL}data/stations-es.json`, {cache: 'force-cache'});
    if (res.ok) {
      const json = (await res.json()) as {stations?: RawStation[]};
      if (Array.isArray(json.stations)) {
        return json.stations.map((s) => hydrateStation(s)).filter((s): s is Station => s !== null);
      }
    }
  } catch {
    // Ignore
  }
  return [];
}

export async function loadCountriesList(): Promise<CountryItem[]> {
  const byCode = new Map<string, CountryItem>();
  for (const fc of FEATURED_COUNTRIES) {
    byCode.set(fc.code, {...fc});
  }

  try {
    const raw = await fetchJsonRotating<RawCountry[]>('countries?order=stationcount&reverse=true&hidebroken=true', 6000);
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const code = (item.iso_3166_1 || '').toUpperCase().trim();
        const count = Number(item.stationcount) || 0;
        if (code.length !== 2 || count < 5) continue;
        const existing = byCode.get(code);
        const centroid = COUNTRY_CENTROIDS[code];
        if (existing) {
          existing.stationCount = Math.max(existing.stationCount, count);
        } else {
          byCode.set(code, {
            code,
            name: centroid?.name || (item.name || code).trim(),
            flag: countryCodeToFlag(code),
            stationCount: count,
            lat: centroid?.lat ?? 20,
            lng: centroid?.lng ?? 0,
            zoom: centroid?.zoom ?? 4.5,
          });
        }
      }
    }
  } catch {
    // Keep featured countries list seamlessly
  }

  return Array.from(byCode.values()).sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return b.stationCount - a.stationCount;
  });
}

export async function fetchStationByUuid(uuid: string): Promise<Station | null> {
  const clean = uuid.replace(/[^A-Za-z0-9-]/g, '');
  if (!clean) return null;
  try {
    const raw = await fetchJsonRotating<RawStation[]>(`stations/byuuid/${clean}`, 7000);
    if (Array.isArray(raw) && raw[0]) {
      return hydrateStation(raw[0]);
    }
  } catch {
    // Ignore
  }
  return null;
}

export function pingStationClick(uuid: string): void {
  const clean = uuid.replace(/[^A-Za-z0-9-]/g, '');
  if (!clean) return;
  const candidates = getEndpointCandidates(`url/${clean}`);
  if (candidates[0]) {
    fetch(candidates[0], {method: 'GET'}).catch(() => undefined);
  }
}
