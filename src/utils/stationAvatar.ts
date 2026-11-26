import type {Station} from '../types';
import {escapeHtml, sanitizeExternalUrl} from './geo';

const BLOCKED_FAVICON_HOSTS = [
  'clearbit.com',
  'fbcdn.net',
  'facebook.com',
  'radiovolna.net',
  'postimg.cc',
  'radio.es',
  'radioplayer.org',
  'cloudfront.net',
];

const failedFavicons = new Set<string>();

// Register global callback for inline onerror handlers
(window as unknown as {__markFaviconFailed?: (url: string) => void}).__markFaviconFailed = (url: string) => {
  if (url) failedFavicons.add(url);
};

export function isUsableFavicon(raw: string): string | null {
  const safe = sanitizeExternalUrl(raw);
  if (!safe || !safe.startsWith('https://')) return null;
  if (failedFavicons.has(safe)) return null;
  try {
    const host = new URL(safe).hostname.toLowerCase();
    if (BLOCKED_FAVICON_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
      return null;
    }
    return safe;
  } catch {
    return null;
  }
}

const AVATAR_TONES = [
  'bg-emerald-50 text-emerald-800 border-emerald-200/70 dark:bg-[#243b38] dark:text-[#6ee7b7] dark:border-[#32524d]',
  'bg-sky-50 text-sky-800 border-sky-200/70 dark:bg-[#243449] dark:text-[#93c5fd] dark:border-[#344a66]',
  'bg-amber-50 text-amber-800 border-amber-200/70 dark:bg-[#3a3425] dark:text-[#fde68a] dark:border-[#524932]',
  'bg-rose-50 text-rose-800 border-rose-200/70 dark:bg-[#3a2832] dark:text-[#fda4af] dark:border-[#543746]',
  'bg-indigo-50 text-indigo-800 border-indigo-200/70 dark:bg-[#292d47] dark:text-[#c7d2fe] dark:border-[#3b4166]',
  'bg-teal-50 text-teal-800 border-teal-200/70 dark:bg-[#21383c] dark:text-[#5eead4] dark:border-[#2f5056]',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getInitials(name: string): string {
  const cleaned = (name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return 'FM';
  if (cleaned.length === 1) return cleaned[0].slice(0, 2).toUpperCase();
  return `${cleaned[0][0]}${cleaned[1][0]}`.toUpperCase();
}

export function renderStationAvatar(station: Station, sizeClass = 'w-10 h-10', tryFavicon = false): string {
  const tone = AVATAR_TONES[hashName(station.name) % AVATAR_TONES.length];
  const initials = escapeHtml(getInitials(station.name));
  const textSize = sizeClass.includes('w-14') ? 'text-base' : 'text-xs';

  const fallbackBox = `<div class="${sizeClass} rounded-xl border ${tone} flex items-center justify-center font-bold tracking-tight ${textSize} shrink-0 select-none">${initials}</div>`;

  if (!tryFavicon) {
    return fallbackBox;
  }

  const safeFav = isUsableFavicon(station.favicon);
  if (!safeFav) {
    return fallbackBox;
  }

  const escapedFav = escapeHtml(safeFav);
  return `<img src="${escapedFav}" alt="" loading="lazy" referrerpolicy="no-referrer" class="${sizeClass} rounded-xl object-cover bg-slate-100 dark:bg-[#2a3346] border border-slate-200/70 dark:border-[#343e52] shrink-0" onerror="window.__markFaviconFailed && window.__markFaviconFailed(this.src);this.style.display='none';this.nextElementSibling.style.display='flex'" /><div style="display:none" class="${sizeClass} rounded-xl border ${tone} items-center justify-center font-bold tracking-tight ${textSize} shrink-0 select-none">${initials}</div>`;
}
