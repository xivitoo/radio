import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function normalizeBasePath(raw?: string): string {
  if (!raw || raw === '/') return '/';
  let base = raw.startsWith('/') ? raw : `/${raw}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

function buildManifestJson(basePath: string): string {
  const manifest = {
    id: basePath,
    name: 'Radio by XivIoT',
    short_name: 'Radio XivIoT',
    description:
      'Escucha emisoras de radio en directo de todo el mundo, explora el mapa interactivo y guarda tus favoritas.',
    start_url: basePath,
    scope: basePath,
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'es',
    theme_color: '#1e2432',
    background_color: '#1d2939',
    categories: ['music', 'news', 'entertainment'],
    icons: [
      {
        src: `${basePath}pwa-192x192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${basePath}pwa-512x512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${basePath}pwa-maskable-512x512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return JSON.stringify(manifest, null, 2);
}

export default defineConfig(() => {
  const basePath = normalizeBasePath(process.env.VITE_BASE_PATH);

  return {
    base: basePath,
    plugins: [
      tailwindcss(),
      {
        name: 'dynamic-manifest-webmanifest',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === `${basePath}manifest.webmanifest` || req.url === '/manifest.webmanifest') {
              res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
              res.end(buildManifestJson(basePath));
              return;
            }
            next();
          });
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.webmanifest',
            source: buildManifestJson(basePath),
          });
        },
      },
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." still resolve in production builds.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
