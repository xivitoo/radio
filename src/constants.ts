import type {CountryItem} from './types';

export const RADIO_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

export const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const QUICK_FAVORITE_TAGS = ['🏠 Casa', '🚗 Coche', '💼 Trabajo'] as const;

export const FEATURED_COUNTRIES: CountryItem[] = [
  {code: 'ES', name: 'España', flag: '🇪🇸', stationCount: 1500, lat: 40.25, lng: -3.7, zoom: 5.7, featured: true},
  {code: 'MX', name: 'México', flag: '🇲🇽', stationCount: 1100, lat: 23.6, lng: -102.5, zoom: 4.9, featured: true},
  {code: 'AR', name: 'Argentina', flag: '🇦🇷', stationCount: 950, lat: -35.5, lng: -63.6, zoom: 4.4, featured: true},
  {code: 'CO', name: 'Colombia', flag: '🇨🇴', stationCount: 680, lat: 4.57, lng: -74.3, zoom: 5.5, featured: true},
  {code: 'CL', name: 'Chile', flag: '🇨🇱', stationCount: 520, lat: -35.6, lng: -71.5, zoom: 4.5, featured: true},
  {code: 'US', name: 'EE. UU.', flag: '🇺🇸', stationCount: 5400, lat: 39.5, lng: -98.35, zoom: 4.0, featured: true},
  {code: 'GB', name: 'Reino Unido', flag: '🇬🇧', stationCount: 1600, lat: 54.0, lng: -2.5, zoom: 5.6, featured: true},
  {code: 'PE', name: 'Perú', flag: '🇵🇪', stationCount: 410, lat: -9.19, lng: -75.01, zoom: 5.2, featured: true},
  {code: 'FR', name: 'Francia', flag: '🇫🇷', stationCount: 2100, lat: 46.6, lng: 2.2, zoom: 5.5},
  {code: 'DE', name: 'Alemania', flag: '🇩🇪', stationCount: 3200, lat: 51.1, lng: 10.4, zoom: 5.5},
  {code: 'IT', name: 'Italia', flag: '🇮🇹', stationCount: 1800, lat: 42.5, lng: 12.5, zoom: 5.5},
  {code: 'PT', name: 'Portugal', flag: '🇵🇹', stationCount: 420, lat: 39.6, lng: -8.0, zoom: 6.2},
  {code: 'BR', name: 'Brasil', flag: '🇧🇷', stationCount: 2100, lat: -14.2, lng: -51.9, zoom: 4.1},
  {code: 'UY', name: 'Uruguay', flag: '🇺🇾', stationCount: 210, lat: -32.5, lng: -55.7, zoom: 6.3},
  {code: 'EC', name: 'Ecuador', flag: '🇪🇨', stationCount: 280, lat: -1.8, lng: -78.1, zoom: 6.0},
  {code: 'VE', name: 'Venezuela', flag: '🇻🇪', stationCount: 220, lat: 6.4, lng: -66.5, zoom: 5.4},
  {code: 'CR', name: 'Costa Rica', flag: '🇨🇷', stationCount: 140, lat: 9.7, lng: -83.7, zoom: 6.8},
  {code: 'DO', name: 'Rep. Dominicana', flag: '🇩🇴', stationCount: 190, lat: 18.7, lng: -70.1, zoom: 6.8},
  {code: 'CA', name: 'Canadá', flag: '🇨🇦', stationCount: 1200, lat: 56.1, lng: -106.3, zoom: 3.7},
  {code: 'CH', name: 'Suiza', flag: '🇨🇭', stationCount: 520, lat: 46.8, lng: 8.2, zoom: 7.0},
  {code: 'NL', name: 'Países Bajos', flag: '🇳🇱', stationCount: 980, lat: 52.1, lng: 5.3, zoom: 6.9},
  {code: 'BE', name: 'Bélgica', flag: '🇧🇪', stationCount: 540, lat: 50.5, lng: 4.4, zoom: 7.0},
  {code: 'JP', name: 'Japón', flag: '🇯🇵', stationCount: 480, lat: 36.2, lng: 138.2, zoom: 5.0},
  {code: 'AU', name: 'Australia', flag: '🇦🇺', stationCount: 780, lat: -25.2, lng: 133.7, zoom: 4.0},
];

export const COUNTRY_CENTROIDS: Record<string, {lat: number; lng: number; zoom: number; name?: string}> = {
  ES: {lat: 40.25, lng: -3.7, zoom: 5.7, name: 'España'},
  MX: {lat: 23.6, lng: -102.5, zoom: 4.9, name: 'México'},
  AR: {lat: -35.5, lng: -63.6, zoom: 4.4, name: 'Argentina'},
  CO: {lat: 4.57, lng: -74.3, zoom: 5.5, name: 'Colombia'},
  CL: {lat: -35.6, lng: -71.5, zoom: 4.5, name: 'Chile'},
  US: {lat: 39.5, lng: -98.35, zoom: 4.0, name: 'EE. UU.'},
  GB: {lat: 54.0, lng: -2.5, zoom: 5.6, name: 'Reino Unido'},
  PE: {lat: -9.19, lng: -75.01, zoom: 5.2, name: 'Perú'},
  FR: {lat: 46.6, lng: 2.2, zoom: 5.5, name: 'Francia'},
  DE: {lat: 51.1, lng: 10.4, zoom: 5.5, name: 'Alemania'},
  IT: {lat: 42.5, lng: 12.5, zoom: 5.5, name: 'Italia'},
  PT: {lat: 39.6, lng: -8.0, zoom: 6.2, name: 'Portugal'},
  BR: {lat: -14.2, lng: -51.9, zoom: 4.1, name: 'Brasil'},
  UY: {lat: -32.5, lng: -55.7, zoom: 6.3, name: 'Uruguay'},
  EC: {lat: -1.8, lng: -78.1, zoom: 6.0, name: 'Ecuador'},
  VE: {lat: 6.4, lng: -66.5, zoom: 5.4, name: 'Venezuela'},
  CR: {lat: 9.7, lng: -83.7, zoom: 6.8, name: 'Costa Rica'},
  DO: {lat: 18.7, lng: -70.1, zoom: 6.8, name: 'Rep. Dominicana'},
  CA: {lat: 56.1, lng: -106.3, zoom: 3.7, name: 'Canadá'},
  CH: {lat: 46.8, lng: 8.2, zoom: 7.0, name: 'Suiza'},
  NL: {lat: 52.1, lng: 5.3, zoom: 6.9, name: 'Países Bajos'},
  BE: {lat: 50.5, lng: 4.4, zoom: 7.0, name: 'Bélgica'},
  JP: {lat: 36.2, lng: 138.2, zoom: 5.0, name: 'Japón'},
  AU: {lat: -25.2, lng: 133.7, zoom: 4.0, name: 'Australia'},
};

export function countryCodeToFlag(code: string): string {
  const clean = (code || '').toUpperCase().trim();
  if (clean.length !== 2) return '🌍';
  const base = 127397;
  return String.fromCodePoint(clean.charCodeAt(0) + base, clean.charCodeAt(1) + base);
}
