import {CACHE_TTL_MS} from '../constants';
import type {CachedStationsPayload, FavoriteEntry, Station, ThemeMode} from '../types';

const KEYS = {
  COUNTRY: 'radio_selected_country',
  THEME: 'radio_theme',
  FAVORITES: 'radio_favorites',
  RECENTS: 'radio_recents',
  VOLUME: 'radio_volume',
  CACHE_PREFIX: 'radio_cache_',
} as const;

export function getSavedCountry(): string | null {
  try {
    const val = localStorage.getItem(KEYS.COUNTRY);
    return val && val.trim().length === 2 ? val.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

export function saveSelectedCountry(countryCode: string): void {
  try {
    localStorage.setItem(KEYS.COUNTRY, countryCode.toUpperCase());
  } catch {
    // Ignore storage quota errors
  }
}

export function getSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEYS.THEME);
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore
  }
  return 'light';
}

export function saveTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(KEYS.THEME, theme);
  } catch {
    // Ignore
  }
}

export function getSavedVolume(): number {
  try {
    const raw = localStorage.getItem(KEYS.VOLUME);
    if (!raw) return 0.9;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  } catch {
    // Ignore
  }
  return 0.9;
}

export function saveVolume(volume: number): void {
  try {
    localStorage.setItem(KEYS.VOLUME, String(Math.max(0, Math.min(1, volume))));
  } catch {
    // Ignore
  }
}

export function getCachedStations(countryCode: string): {payload: CachedStationsPayload; isFresh: boolean} | null {
  try {
    const raw = localStorage.getItem(`${KEYS.CACHE_PREFIX}${countryCode.toUpperCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStationsPayload;
    if (!parsed || !Array.isArray(parsed.stations) || parsed.stations.length === 0) return null;
    const age = Date.now() - (parsed.updatedAt || 0);
    return {
      payload: parsed,
      isFresh: age <= CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

export function saveCachedStations(countryCode: string, stations: Station[]): void {
  try {
    const compact = stations.slice(0, 500).map((s) => ({
      stationuuid: s.stationuuid,
      name: s.name,
      url: s.url,
      url_resolved: s.url_resolved,
      homepage: s.homepage,
      favicon: s.favicon,
      tags: s.tags,
      country: s.country,
      countrycode: s.countrycode,
      state: s.state,
      language: s.language,
      votes: s.votes,
      clickcount: s.clickcount,
      codec: s.codec,
      bitrate: s.bitrate,
      geo_lat: s.geo_lat,
      geo_long: s.geo_long,
      lastcheckok: s.lastcheckok,
    }));
    const payload: CachedStationsPayload = {
      updatedAt: Date.now(),
      countryCode: countryCode.toUpperCase(),
      stations: compact,
    };
    localStorage.setItem(`${KEYS.CACHE_PREFIX}${countryCode.toUpperCase()}`, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function getFavoritesMap(): Record<string, FavoriteEntry> {
  try {
    const raw = localStorage.getItem(KEYS.FAVORITES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, FavoriteEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFavoritesMap(map: Record<string, FavoriteEntry>): void {
  try {
    localStorage.setItem(KEYS.FAVORITES, JSON.stringify(map));
  } catch {
    // Ignore
  }
}

export function getRecentStations(): Station[] {
  try {
    const raw = localStorage.getItem(KEYS.RECENTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Station[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushRecentStation(station: Station): Station[] {
  const existing = getRecentStations().filter((s) => s.stationuuid !== station.stationuuid);
  const next = [station, ...existing].slice(0, 20);
  try {
    localStorage.setItem(KEYS.RECENTS, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}
