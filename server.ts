import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const USER_AGENT = 'RadioByXivIoT/1.0 (+https://xivitoo.github.io/radio/)';
const RADIO_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const responseCache = new Map<string, {expiresAt: number; payload: string; contentType: string}>();

const ALLOWED_ROUTE_PATTERNS = [
  /^countries$/,
  /^stations\/bycountrycodeexact\/[A-Za-z]{2}$/,
  /^stations\/byuuid\/[A-Za-z0-9-]+$/,
  /^stations\/search$/,
  /^url\/[A-Za-z0-9-]+$/,
];

function isAllowedRadioPath(subpath: string): boolean {
  const clean = subpath.replace(/^\/+/, '').replace(/^json\//, '');
  return ALLOWED_ROUTE_PATTERNS.some((pattern) => pattern.test(clean));
}

async function fetchFromMirrors(subpath: string, search: string): Promise<{payload: string; contentType: string}> {
  const cleanPath = subpath.replace(/^\/+/, '').replace(/^json\//, '');
  const cacheKey = `${cleanPath}${search}`;
  const isClickPing = cleanPath.startsWith('url/');

  if (!isClickPing) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {payload: cached.payload, contentType: cached.contentType};
    }
  }

  let lastError: unknown;
  for (const mirror of RADIO_MIRRORS) {
    const targetUrl = `${mirror}/json/${cleanPath}${search}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        lastError = new Error(`HTTP ${upstream.status}`);
        continue;
      }

      const payload = await upstream.text();
      const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

      if (!isClickPing) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          payload,
          contentType,
        });
      }
      return {payload, contentType};
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All mirrors unavailable');
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  app.use('/api/radio', async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.status(204).end();
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({error: 'Method not allowed'});
      return;
    }

    const rawPath = req.path.replace(/^\/+/, '');
    if (!isAllowedRadioPath(rawPath)) {
      res.status(400).json({error: 'Invalid radio route'});
      return;
    }

    const queryIdx = req.originalUrl.indexOf('?');
    const search = queryIdx >= 0 ? req.originalUrl.slice(queryIdx) : '';

    try {
      const {payload, contentType} = await fetchFromMirrors(rawPath, search);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.status(200).send(payload);
    } catch {
      res.status(502).json({error: 'Radio upstream unavailable'});
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, {maxAge: '1d'}));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Radio by XivIoT server listening on http://localhost:${PORT}`);
  });
}

startServer();
