export interface Station {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  votes: number;
  clickcount: number;
  codec: string;
  bitrate: number;
  geo_lat: number | null;
  geo_long: number | null;
  lastcheckok: number;
  // Precomputed Mercator coordinates [0..1]
  mx?: number;
  my?: number;
  category?: CategoryFilter;
}

export interface CountryItem {
  code: string;
  name: string;
  nativeName?: string;
  stationCount: number;
  flag: string;
  lat: number;
  lng: number;
  zoom: number;
  featured?: boolean;
}

export type CategoryFilter = 'all' | 'music' | 'news' | 'sports';
export type TabId = 'explore' | 'top' | 'favorites';
export type SheetHeight = 'min' | 'mid' | 'full';
export type SortMode = 'popular' | 'nearby';
export type ThemeMode = 'light' | 'dark';

export type ConnectionMode = 'online' | 'recent-cache' | 'offline-prompt' | 'offline-backup';

export type PlayerStatus = 'idle' | 'connecting' | 'playing' | 'paused' | 'error';

export interface FavoriteEntry {
  station: Station;
  tag: string;
  savedAt: number;
}

export interface CachedStationsPayload {
  updatedAt: number;
  countryCode: string;
  stations: Station[];
}

export interface UserLocation {
  lat: number;
  lng: number;
}
