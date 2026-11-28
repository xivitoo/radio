#!/usr/bin/env node
/**
 * Zero-dependency script to download verified Spanish stations from Radio Browser
 * and store:
 *  - public/data/stations-es.json (compact offline fallback snapshot)
 *  - public/stream.json (voice-friendly catalog for Alexa Skills & Home Assistant)
 *  - public/radio.m3u (standard M3U playlist for smart speakers & media players)
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'public', 'data', 'stations-es.json');
const OUT_STREAM_JSON = path.join(ROOT_DIR, 'public', 'stream.json');
const OUT_M3U = path.join(ROOT_DIR, 'public', 'radio.m3u');
const PUBLIC_BASE_URL = 'https://xivitoo.github.io/radio/';

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

function normalizeVoiceText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAliases(name, state) {
  const aliases = new Set();
  const base = normalizeVoiceText(name);
  if (base) aliases.add(base);

  const withoutParens = normalizeVoiceText(String(name || '').replace(/\([^)]*\)/g, ' '));
  if (withoutParens) aliases.add(withoutParens);

  // Strip trailing FM/AM frequencies like "93 9 fm" or "104.3"
  const withoutFreq = withoutParens
    .replace(/\b\d+(?:\s+\d+)?\s*(?:fm|am|mhz|khz)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutFreq) aliases.add(withoutFreq);

  // Collapse and expand letter-number boundaries (e.g. "los40" <-> "los 40")
  for (const candidate of Array.from(aliases)) {
    const spaced = candidate.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').trim();
    const joined = candidate.replace(/([a-z])\s+(\d)/g, '$1$2').trim();
    if (spaced) aliases.add(spaced);
    if (joined) aliases.add(joined);
  }

  const normState = normalizeVoiceText(state);
  if (normState && withoutFreq.endsWith(` ${normState}`)) {
    const shortName = withoutFreq.slice(0, -(normState.length + 1)).trim();
    if (shortName.length >= 3) aliases.add(shortName);
  }

  return Array.from(aliases).filter(Boolean);
}

function resolveStreamFormat(codec, streamUrl) {
  const upperCodec = String(codec || '').toUpperCase().trim();
  const lowerUrl = String(streamUrl || '').toLowerCase();
  if (/\.m3u8(\?|$)/i.test(lowerUrl) || upperCodec === 'HLS') return 'hls';
  if (upperCodec.includes('AAC')) return 'aac';
  if (upperCodec.includes('OGG') || upperCodec.includes('OPUS')) return 'ogg';
  if (upperCodec.includes('MP3')) return 'mp3';
  return (upperCodec || 'mp3').toLowerCase();
}

function sanitizeM3uAttr(value) {
  return String(value || '')
    .replace(/[\r\n"]+/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const updatedAt = new Date().toISOString();

  // 1. Offline fallback snapshot for the web app
  fs.mkdirSync(path.dirname(OUT_FILE), {recursive: true});
  const snapshotPayload = {
    updatedAt,
    countrycode: 'ES',
    count: finalStations.length,
    stations: finalStations,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshotPayload), 'utf8');
  console.log(`Saved ${finalStations.length} HTTPS stations to ${OUT_FILE}`);

  // 2. Public stream.json for Alexa Skills & Home Assistant integrations
  const streamsCatalog = finalStations.map((st) => {
    const format = resolveStreamFormat(st.codec, st.url_resolved);
    const tags = st.tags
      ? st.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    return {
      id: st.stationuuid,
      name: st.name,
      normalized: normalizeVoiceText(st.name),
      aliases: buildAliases(st.name, st.state),
      streamUrl: st.url_resolved,
      format,
      codec: st.codec || 'MP3',
      bitrate: st.bitrate,
      country: st.country,
      countrycode: st.countrycode,
      region: st.state,
      tags,
      hls: format === 'hls',
    };
  });

  const streamPayload = {
    name: 'Radio by XivIoT',
    updatedAt,
    baseUrl: PUBLIC_BASE_URL,
    m3uUrl: `${PUBLIC_BASE_URL}radio.m3u`,
    count: streamsCatalog.length,
    streams: streamsCatalog,
  };
  fs.writeFileSync(OUT_STREAM_JSON, JSON.stringify(streamPayload, null, 2), 'utf8');
  console.log(`Saved ${streamsCatalog.length} entries to ${OUT_STREAM_JSON}`);

  // 3. Public radio.m3u playlist
  const m3uLines = ['#EXTM3U'];
  for (const st of finalStations) {
    const cleanName = sanitizeM3uAttr(st.name);
    const groupTitle = sanitizeM3uAttr(st.state || st.country || 'España');
    m3uLines.push(
      `#EXTINF:-1 tvg-id="${sanitizeM3uAttr(st.stationuuid)}" tvg-name="${cleanName}" group-title="${groupTitle}",${cleanName}`
    );
    m3uLines.push(st.url_resolved);
  }
  fs.writeFileSync(OUT_M3U, `${m3uLines.join('\n')}\n`, 'utf8');
  console.log(`Saved M3U playlist (${finalStations.length} stations) to ${OUT_M3U}`);
}

main().catch((err) => {
  console.error('Failed to update static stations:', err);
  process.exitCode = 1;
});
