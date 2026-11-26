import type {CategoryFilter, Station} from '../types';

const MAX_LAT = 85.05112878;

export function latLonToMercator(lat: number, lon: number): {mx: number; my: number} {
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const mx = (lon + 180) / 360;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const my = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return {mx, my};
}

export function mercatorToLatLon(mx: number, my: number): {lat: number; lon: number} {
  const lon = mx * 360 - 180;
  const n = Math.PI - 2 * Math.PI * my;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {lat, lon};
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SPORTS_RE = /\b(sport|sports|deporte|deportes|f[uú]tbol|soccer|nba|nfl|f1|racing|marca|cope tiempo|carrusel)\b/i;
const NEWS_RE = /\b(news|noticias|talk|info|information|actualidad|informativos|debate|politica|pol[ií]tica|bbc|npr|cadena ser|rne|cope|onda cero)\b/i;
const MUSIC_RE = /\b(music|m[uú]sica|pop|rock|jazz|dance|electronic|techno|house|hits|top 40|classical|cl[aá]sica|indie|latin|reguet[oó]n|salsa|flamenco|hiphop|r&b|blues|folk|metal|80s|90s|los40|cadena 100|europa fm|kiss fm|rock fm)\b/i;

export function classifyStation(station: Pick<Station, 'name' | 'tags'>): CategoryFilter {
  const haystack = `${station.name} ${station.tags}`.toLowerCase();
  if (SPORTS_RE.test(haystack)) return 'sports';
  if (NEWS_RE.test(haystack)) return 'news';
  if (MUSIC_RE.test(haystack)) return 'music';
  // Default most radio stations with generic tags to music if not explicitly talk/news/sports
  return station.tags.trim().length > 0 ? 'music' : 'all';
}

export function formatCodec(codec: string): string {
  const upper = (codec || '').toUpperCase().trim();
  if (!upper) return 'STREAM';
  if (upper.includes('AAC')) return 'AAC';
  if (upper.includes('MP3')) return 'MP3';
  if (upper.includes('OGG') || upper.includes('OPUS') || upper.includes('VORBIS')) return 'OGG';
  if (upper.includes('FLAC')) return 'FLAC';
  return upper.slice(0, 6);
}

export function formatTags(tags: string, limit = 4): string[] {
  return (tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function sanitizeExternalUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
