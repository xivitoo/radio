#!/usr/bin/env node
/**
 * Zero-dependency script to download verified Spanish stations from Radio Browser
 * and store a compact offline fallback snapshot at public/data/stations-es.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'public', 'data', 'stations-es.json');

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

const USER_AGENT = 'RadioByXivIoT-StaticSync/1.0 (+https://xivitoo.github.io/radio/)';

async function fetchJsonWithMirrors(endpoint) {
  let lastError = null;
  for (const mirror of MIRRORS) {
    const url = `${mirror}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} from ${mirror}`);
        continue;
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }
  throw lastError || new Error('All Radio Browser mirrors failed');
}

function compactStation(raw) {
  const url = (raw.url_resolved || raw.url || '').trim();
  return {
    stationuuid: raw.stationuuid,
    name: (raw.name || '').trim().replace(/\s+/g, ' '),
    url: (raw.url || '').trim(),
    url_resolved: url,
    homepage: (raw.homepage || '').trim(),
    favicon: (raw.favicon || '').trim(),
    tags: (raw.tags || '').trim(),
    country: raw.country || 'Spain',
    countrycode: (raw.countrycode || 'ES').toUpperCase(),
    state: (raw.state || '').trim(),
    language: (raw.language || '').trim(),
    votes: Number(raw.votes) || 0,
    clickcount: Number(raw.clickcount) || 0,
    codec: (raw.codec || '').toUpperCase(),
    bitrate: Number(raw.bitrate) || 0,
    geo_lat: typeof raw.geo_lat === 'number' ? raw.geo_lat : null,
    geo_long: typeof raw.geo_long === 'number' ? raw.geo_long : null,
    lastcheckok: Number(raw.lastcheckok) || 0,
  };
}

async function main() {
  const endpoint =
    '/json/stations/bycountrycodeexact/ES?hidebroken=true&order=clickcount&reverse=true&limit=800';
  console.log('Fetching verified ES stations from Radio Browser...');
  const rawStations = await fetchJsonWithMirrors(endpoint);

  if (!Array.isArray(rawStations)) {
    throw new Error('Unexpected response format');
  }

  const seenUrls = new Set();
  const valid = [];

  for (const item of rawStations) {
    if (Number(item.lastcheckok) !== 1) continue;
    const streamUrl = (item.url_resolved || item.url || '').trim();
    if (!streamUrl.startsWith('https://')) continue;
    const lowerUrl = streamUrl.toLowerCase();
    const codec = (item.codec || '').toUpperCase().trim();
    if (/\.(pls|m3u|asx|ram|wax)(\?|$)/i.test(lowerUrl)) continue;
    if (codec === 'FLV' || (codec === 'UNKNOWN' && lowerUrl.endsWith('/chunks.m3u8'))) continue;
    if (seenUrls.has(streamUrl)) continue;
    seenUrls.add(streamUrl);
    const compacted = compactStation(item);
    if (!compacted.name || !compacted.stationuuid) continue;
    valid.push(compacted);
  }

  // Sort by clickcount + votes descending
  valid.sort((a, b) => b.clickcount + b.votes * 2 - (a.clickcount + a.votes * 2));
  const finalStations = valid.slice(0, 500);

  fs.mkdirSync(path.dirname(OUT_FILE), {recursive: true});
  const payload = {
    updatedAt: new Date().toISOString(),
    countrycode: 'ES',
    count: finalStations.length,
    stations: finalStations,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload), 'utf8');
  console.log(`Saved ${finalStations.length} HTTPS stations to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Failed to update static stations:', err);
  process.exitCode = 1;
});
