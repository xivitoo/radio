import type {Station, ThemeMode, UserLocation} from '../types';
import {latLonToMercator} from '../utils/geo';
import {icons} from '../utils/icons';

const CARTO_KEY = (import.meta.env.VITE_CARTODB_API_KEY as string | undefined)?.trim() || '';
const TILE_SIZE = 256;
const MIN_ZOOM = 2.2;
const MAX_ZOOM = 16;

interface TileEntry {
  key: string;
  img: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
  lastUsed: number;
}

interface LabelHitbox {
  station: Station;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MarkerHitbox {
  station: Station;
  x: number;
  y: number;
  r: number;
}

export interface CanvasMapOptions {
  container: HTMLElement;
  theme: ThemeMode;
  paused?: boolean;
  onSelectStation: (station: Station) => void;
  onInteract?: () => void;
}

export class CanvasMap {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private zoomInBtn: HTMLButtonElement;
  private zoomOutBtn: HTMLButtonElement;

  private theme: ThemeMode;
  private paused: boolean;
  private stations: Station[] = [];
  private selectedId: string | null = null;
  private playingId: string | null = null;
  private hoveredId: string | null = null;
  private userLocation: UserLocation | null = null;

  private centerMx = 0.489; // Spain default
  private centerMy = 0.378;
  private zoom = 5.6;
  private targetCenterMx: number | null = null;
  private targetCenterMy: number | null = null;
  private targetZoom: number | null = null;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private tiles = new Map<string, TileEntry>();
  private rafId: number | null = null;
  private dirty = true;

  // Pointer / touch / inertia state
  private activePointers = new Map<number, {x: number; y: number}>();
  private isDragging = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastMoveTime = 0;
  private vx = 0;
  private vy = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 5.6;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;

  private markerHitboxes: MarkerHitbox[] = [];
  private labelHitboxes: LabelHitbox[] = [];
  private resizeObserver: ResizeObserver;

  private onSelectStation: (station: Station) => void;
  private onInteract?: () => void;

  constructor(options: CanvasMapOptions) {
    this.container = options.container;
    this.theme = options.theme;
    this.paused = Boolean(options.paused);
    this.onSelectStation = options.onSelectStation;
    this.onInteract = options.onInteract;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'block w-full h-full touch-none select-none cursor-grab active:cursor-grabbing';
    this.canvas.setAttribute('aria-label', 'Mapa interactivo de emisoras de radio');
    this.container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d', {alpha: false});
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;

    // Accessible zoom controls
    const zoomGroup = document.createElement('div');
    zoomGroup.className =
      'absolute right-3.5 bottom-[152px] lg:right-6 lg:bottom-6 z-20 flex flex-col rounded-2xl overflow-hidden border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 shadow-lg backdrop-blur-md';

    this.zoomInBtn = document.createElement('button');
    this.zoomInBtn.type = 'button';
    this.zoomInBtn.setAttribute('aria-label', 'Acercar mapa');
    this.zoomInBtn.className =
      'min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a3346] active:bg-slate-200 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors border-b border-slate-200/80 dark:border-[#343e52]';
    this.zoomInBtn.innerHTML = icons.plus('w-5 h-5');

    this.zoomOutBtn = document.createElement('button');
    this.zoomOutBtn.type = 'button';
    this.zoomOutBtn.setAttribute('aria-label', 'Alejar mapa');
    this.zoomOutBtn.className =
      'min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a3346] active:bg-slate-200 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors';
    this.zoomOutBtn.innerHTML = icons.minus('w-5 h-5');

    zoomGroup.appendChild(this.zoomInBtn);
    zoomGroup.appendChild(this.zoomOutBtn);
    this.container.appendChild(zoomGroup);

    this.zoomInBtn.addEventListener('click', () => {
      this.onInteract?.();
      this.zoomBy(1);
    });
    this.zoomOutBtn.addEventListener('click', () => {
      this.onInteract?.();
      this.zoomBy(-1);
    });

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.handleResize();
  }

  public setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.requestDraw();
    }
  }

  public setTheme(theme: ThemeMode): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.tiles.clear();
    this.requestDraw();
  }

  public setStations(stations: Station[]): void {
    this.stations = stations.filter((s) => typeof s.mx === 'number' && typeof s.my === 'number');
    this.requestDraw();
  }

  public setSelectedStation(stationUuid: string | null): void {
    this.selectedId = stationUuid;
    this.requestDraw();
  }

  public setPlayingStation(stationUuid: string | null): void {
    this.playingId = stationUuid;
    this.requestDraw();
  }

  public setUserLocation(location: UserLocation | null): void {
    this.userLocation = location;
    this.requestDraw();
  }

  public flyTo(lat: number, lng: number, zoom?: number): void {
    const {mx, my} = latLonToMercator(lat, lng);
    this.targetCenterMx = mx;
    this.targetCenterMy = my;
    if (typeof zoom === 'number') {
      this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    }
    this.vx = 0;
    this.vy = 0;
    this.requestDraw();
  }

  public jumpTo(lat: number, lng: number, zoom: number): void {
    const {mx, my} = latLonToMercator(lat, lng);
    this.centerMx = mx;
    this.centerMy = my;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this.targetCenterMx = null;
    this.targetCenterMy = null;
    this.targetZoom = null;
    this.vx = 0;
    this.vy = 0;
    this.requestDraw();
  }

  public zoomBy(delta: number): void {
    const base = this.targetZoom ?? this.zoom;
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base + delta));
    this.targetCenterMx = this.centerMx;
    this.targetCenterMy = this.centerMy;
    this.requestDraw();
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.requestDraw();
  }

  private bindEvents(): void {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.activePointers.set(e.pointerId, {x, y});

      this.vx = 0;
      this.vy = 0;
      this.targetCenterMx = null;
      this.targetCenterMy = null;
      this.targetZoom = null;

      if (this.activePointers.size === 1) {
        this.isDragging = true;
        this.dragMoved = false;
        this.dragStartX = x;
        this.dragStartY = y;
        this.lastPointerX = x;
        this.lastPointerY = y;
        this.lastMoveTime = performance.now();
      } else if (this.activePointers.size === 2) {
        this.isDragging = false;
        this.dragMoved = true;
        this.onInteract?.();
        const pts = Array.from(this.activePointers.values());
        this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pinchStartZoom = this.zoom;
      }
    });

    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.activePointers.has(e.pointerId)) {
        const prev = this.activePointers.get(e.pointerId)!;
        this.activePointers.set(e.pointerId, {x, y});

        if (this.activePointers.size === 2) {
          const pts = Array.from(this.activePointers.values());
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (this.pinchStartDist > 10 && dist > 10) {
            const midX = (pts[0].x + pts[1].x) / 2;
            const midY = (pts[0].y + pts[1].y) / 2;
            const scale = dist / this.pinchStartDist;
            const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom + Math.log2(scale)));
            this.zoomAtScreenPoint(nextZoom, midX, midY);
          }
          return;
        }

        if (this.isDragging && this.activePointers.size === 1) {
          const dx = x - this.lastPointerX;
          const dy = y - this.lastPointerY;
          if (!this.dragMoved && Math.hypot(x - this.dragStartX, y - this.dragStartY) > 6) {
            this.dragMoved = true;
            this.onInteract?.();
          }
          const worldPx = TILE_SIZE * Math.pow(2, this.zoom);
          this.centerMx = this.wrapMx(this.centerMx - dx / worldPx);
          this.centerMy = this.clampMy(this.centerMy - dy / worldPx);

          const now = performance.now();
          const dt = Math.max(8, now - this.lastMoveTime);
          this.vx = (dx / dt) * 16;
          this.vy = (dy / dt) * 16;
          this.lastPointerX = x;
          this.lastPointerY = y;
          this.lastMoveTime = now;
          this.requestDraw();
          return;
        }
        void prev;
      } else if (e.pointerType === 'mouse') {
        const hit = this.hitTest(x, y);
        const nextHover = hit ? hit.stationuuid : null;
        if (nextHover !== this.hoveredId) {
          this.hoveredId = nextHover;
          c.style.cursor = hit ? 'pointer' : 'grab';
          this.requestDraw();
        }
      }
    });

    const handlePointerEnd = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const wasDragging = this.isDragging;
      const moved = this.dragMoved;

      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.pinchStartDist = 0;
      }
      if (this.activePointers.size === 0) {
        this.isDragging = false;
      }

      if (wasDragging && !moved && e.type === 'pointerup') {
        const hit = this.hitTest(x, y);
        if (hit) {
          this.onSelectStation(hit);
          return;
        }

        this.onInteract?.();

        // Double tap / double click zoom
        const now = performance.now();
        if (now - this.lastTapTime < 300 && Math.hypot(x - this.lastTapX, y - this.lastTapY) < 28) {
          const nextZoom = Math.min(MAX_ZOOM, this.zoom + 1.4);
          this.zoomAtScreenPoint(nextZoom, x, y);
          this.lastTapTime = 0;
        } else {
          this.lastTapTime = now;
          this.lastTapX = x;
          this.lastTapY = y;
        }
      } else if (moved) {
        // Let inertia glide
        this.requestDraw();
      }
    };

    c.addEventListener('pointerup', handlePointerEnd);
    c.addEventListener('pointercancel', handlePointerEnd);

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onInteract?.();
        const rect = c.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const delta = -e.deltaY * 0.0022;
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom + delta));
        this.zoomAtScreenPoint(nextZoom, x, y);
      },
      {passive: false}
    );
  }

  private zoomAtScreenPoint(nextZoom: number, screenX: number, screenY: number): void {
    const oldWorldPx = TILE_SIZE * Math.pow(2, this.zoom);
    const pointMx = this.centerMx + (screenX - this.width / 2) / oldWorldPx;
    const pointMy = this.centerMy + (screenY - this.height / 2) / oldWorldPx;

    this.zoom = nextZoom;
    const newWorldPx = TILE_SIZE * Math.pow(2, this.zoom);
    this.centerMx = this.wrapMx(pointMx - (screenX - this.width / 2) / newWorldPx);
    this.centerMy = this.clampMy(pointMy - (screenY - this.height / 2) / newWorldPx);
    this.requestDraw();
  }

  private wrapMx(mx: number): number {
    return ((mx % 1) + 1) % 1;
  }

  private clampMy(my: number): number {
    return Math.max(0.05, Math.min(0.95, my));
  }

  private hitTest(x: number, y: number): Station | null {
    // Check labels top-down (drawn last = on top)
    for (let i = this.labelHitboxes.length - 1; i >= 0; i--) {
      const box = this.labelHitboxes[i];
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        return box.station;
      }
    }
    // Check marker circles (touch-friendly radius)
    let best: Station | null = null;
    let bestDist = Infinity;
    for (let i = this.markerHitboxes.length - 1; i >= 0; i--) {
      const m = this.markerHitboxes[i];
      const d = Math.hypot(x - m.x, y - m.y);
      if (d <= m.r && d < bestDist) {
        best = m.station;
        bestDist = d;
      }
    }
    return best;
  }

  private requestDraw(): void {
    this.dirty = true;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.frame());
    }
  }

  private frame(): void {
    this.rafId = null;
    let keepAnimating = false;

    // Smooth flyTo animation
    if (this.targetCenterMx !== null && this.targetCenterMy !== null) {
      let dx = this.targetCenterMx - this.centerMx;
      if (dx > 0.5) dx -= 1;
      if (dx < -0.5) dx += 1;
      const dy = this.targetCenterMy - this.centerMy;
      const dz = this.targetZoom !== null ? this.targetZoom - this.zoom : 0;

      if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5 && Math.abs(dz) < 0.005) {
        this.centerMx = this.targetCenterMx;
        this.centerMy = this.targetCenterMy;
        if (this.targetZoom !== null) this.zoom = this.targetZoom;
        this.targetCenterMx = null;
        this.targetCenterMy = null;
        this.targetZoom = null;
      } else {
        this.centerMx = this.wrapMx(this.centerMx + dx * 0.2);
        this.centerMy = this.clampMy(this.centerMy + dy * 0.2);
        if (this.targetZoom !== null) this.zoom += dz * 0.2;
        keepAnimating = true;
      }
    } else if (!this.isDragging && (Math.abs(this.vx) > 0.15 || Math.abs(this.vy) > 0.15)) {
      const worldPx = TILE_SIZE * Math.pow(2, this.zoom);
      this.centerMx = this.wrapMx(this.centerMx - this.vx / worldPx);
      this.centerMy = this.clampMy(this.centerMy - this.vy / worldPx);
      this.vx *= 0.91;
      this.vy *= 0.91;
      keepAnimating = true;
    }

    if (this.dirty || keepAnimating) {
      this.dirty = false;
      this.render();
    }

    if (keepAnimating) {
      this.rafId = requestAnimationFrame(() => this.frame());
    }
  }

  private getTileUrl(z: number, x: number, y: number): string {
    const sub = ['a', 'b', 'c', 'd'][(x + y) & 3];
    const retina = this.dpr > 1 ? '@2x' : '';
    const style = this.theme === 'dark' ? 'dark_all' : 'rastertiles/voyager';
    const keyParam = CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : '';
    return `https://${sub}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}${retina}.png${keyParam}`;
  }

  private getOrRequestTile(z: number, x: number, y: number): TileEntry {
    const key = `${this.theme}:${z}/${x}/${y}`;
    const existing = this.tiles.get(key);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const entry: TileEntry = {
      key,
      img,
      loaded: false,
      failed: false,
      lastUsed: performance.now(),
    };
    img.onload = () => {
      entry.loaded = true;
      this.requestDraw();
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = this.getTileUrl(z, x, y);
    this.tiles.set(key, entry);

    // Prune tile cache if large
    if (this.tiles.size > 180) {
      const entries = Array.from(this.tiles.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (let i = 0; i < 40; i++) {
        this.tiles.delete(entries[i][0]);
      }
    }

    return entry;
  }

  private drawTileWithParentFallback(
    z: number,
    wrappedX: number,
    y: number,
    dx: number,
    dy: number,
    tileScreenSize: number
  ): void {
    const entry = this.getOrRequestTile(z, wrappedX, y);
    if (entry.loaded && entry.img.naturalWidth > 0) {
      this.ctx.drawImage(entry.img, dx, dy, tileScreenSize + 0.5, tileScreenSize + 0.5);
      return;
    }

    // Draw parent tile fallback while zooming rapidly
    for (let level = 1; level <= 3; level++) {
      const pz = z - level;
      if (pz < 0) break;
      const factor = 1 << level;
      const px = Math.floor(wrappedX / factor);
      const py = Math.floor(y / factor);
      const pKey = `${this.theme}:${pz}/${px}/${py}`;
      const pEntry = this.tiles.get(pKey);
      if (pEntry && pEntry.loaded && pEntry.img.naturalWidth > 0) {
        const subX = wrappedX % factor;
        const subY = y % factor;
        const srcSize = pEntry.img.naturalWidth / factor;
        this.ctx.drawImage(
          pEntry.img,
          subX * srcSize,
          subY * srcSize,
          srcSize,
          srcSize,
          dx,
          dy,
          tileScreenSize + 0.5,
          tileScreenSize + 0.5
        );
        return;
      }
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Base background
    ctx.fillStyle = this.theme === 'dark' ? '#1e2432' : '#e2e8f0';
    ctx.fillRect(0, 0, this.width, this.height);

    const tileZ = Math.max(0, Math.min(18, Math.floor(this.zoom)));
    const numTiles = 1 << tileZ;
    const worldPx = TILE_SIZE * Math.pow(2, this.zoom);
    const tileScreenSize = worldPx / numTiles;

    const topLeftMx = this.centerMx - this.width / 2 / worldPx;
    const topLeftMy = this.centerMy - this.height / 2 / worldPx;

    const minTileX = Math.floor(topLeftMx * numTiles);
    const maxTileX = Math.floor((topLeftMx + this.width / worldPx) * numTiles);
    const minTileY = Math.max(0, Math.floor(topLeftMy * numTiles));
    const maxTileY = Math.min(numTiles - 1, Math.floor((topLeftMy + this.height / worldPx) * numTiles));

    if (!this.paused) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        for (let tx = minTileX; tx <= maxTileX; tx++) {
          const wrappedX = ((tx % numTiles) + numTiles) % numTiles;
          const dx = (tx - topLeftMx * numTiles) * tileScreenSize;
          const dy = (ty - topLeftMy * numTiles) * tileScreenSize;
          this.drawTileWithParentFallback(tileZ, wrappedX, ty, dx, dy, tileScreenSize);
        }
      }
    }

    // Soft pastel dark-mode bath (no ctx.filter for 60fps performance)
    if (this.theme === 'dark') {
      ctx.fillStyle = 'rgba(36, 44, 60, 0.26)';
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Render stations with spatial culling & grid decluttering
    this.markerHitboxes = [];
    this.labelHitboxes = [];

    const pad = 40;
    const cellSize = this.zoom < 6.5 ? 24 : this.zoom < 9 ? 16 : 8;
    const occupiedCells = new Set<string>();
    const showLabels = this.zoom >= 7.2;

    const toScreenX = (mx: number) => {
      let dx = mx - this.centerMx;
      if (dx > 0.5) dx -= 1;
      if (dx < -0.5) dx += 1;
      return this.width / 2 + dx * worldPx;
    };
    const toScreenY = (my: number) => this.height / 2 + (my - this.centerMy) * worldPx;

    // User location pin
    if (this.userLocation) {
      const {mx, my} = latLonToMercator(this.userLocation.lat, this.userLocation.lng);
      const ux = toScreenX(mx);
      const uy = toScreenY(my);
      if (ux >= -pad && ux <= this.width + pad && uy >= -pad && uy <= this.height + pad) {
        ctx.beginPath();
        ctx.arc(ux, uy, 14, 0, Math.PI * 2);
        ctx.fillStyle = this.theme === 'dark' ? 'rgba(147, 197, 253, 0.25)' : 'rgba(37, 99, 235, 0.2)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ux, uy, 6, 0, Math.PI * 2);
        ctx.fillStyle = this.theme === 'dark' ? '#93c5fd' : '#2563eb';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    const visibleSpecial: Station[] = [];
    const regularDraws: Array<{station: Station; x: number; y: number}> = [];

    for (const st of this.stations) {
      if (st.mx === undefined || st.my === undefined) continue;
      const sx = toScreenX(st.mx);
      const sy = toScreenY(st.my);
      if (sx < -pad || sx > this.width + pad || sy < -pad || sy > this.height + pad) continue;

      if (st.stationuuid === this.selectedId || st.stationuuid === this.playingId || st.stationuuid === this.hoveredId) {
        visibleSpecial.push(st);
        continue;
      }

      const gx = Math.floor(sx / cellSize);
      const gy = Math.floor(sy / cellSize);
      const cellKey = `${gx},${gy}`;
      if (occupiedCells.has(cellKey)) continue;
      occupiedCells.add(cellKey);
      regularDraws.push({station: st, x: sx, y: sy});
    }

    const labelCandidates: Array<{station: Station; x: number; y: number; priority: boolean}> = [];

    for (const item of regularDraws) {
      const {station, x, y} = item;
      const highQuality = station.bitrate >= 128 || station.clickcount > 500;
      const radius = this.zoom >= 8 ? 7.5 : 6.2;

      const fill =
        this.theme === 'dark'
          ? highQuality
            ? '#6ee7b7'
            : '#93c5fd'
          : highQuality
            ? '#047857'
            : '#0284c7';

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.theme === 'dark' ? '#1e2432' : '#ffffff';
      ctx.stroke();

      this.markerHitboxes.push({station, x, y, r: 22});
      if (showLabels && labelCandidates.length < 36) {
        labelCandidates.push({station, x, y, priority: false});
      }
    }

    // Draw special (playing / selected / hovered) markers on top
    for (const station of visibleSpecial) {
      const x = toScreenX(station.mx!);
      const y = toScreenY(station.my!);
      const isPlaying = station.stationuuid === this.playingId;
      const isSelected = station.stationuuid === this.selectedId;

      ctx.beginPath();
      ctx.arc(x, y, isPlaying ? 17 : 14, 0, Math.PI * 2);
      ctx.fillStyle =
        this.theme === 'dark'
          ? isPlaying
            ? 'rgba(253, 230, 138, 0.25)'
            : 'rgba(147, 197, 253, 0.25)'
          : isPlaying
            ? 'rgba(217, 119, 6, 0.2)'
            : 'rgba(2, 132, 199, 0.2)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, isPlaying || isSelected ? 9 : 8, 0, Math.PI * 2);
      ctx.fillStyle =
        this.theme === 'dark'
          ? isPlaying
            ? '#fde68a'
            : '#93c5fd'
          : isPlaying
            ? '#d97706'
            : '#0284c7';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = this.theme === 'dark' ? '#1e2432' : '#ffffff';
      ctx.stroke();

      this.markerHitboxes.push({station, x, y, r: 26});
      labelCandidates.push({station, x, y, priority: true});
    }

    // Draw station labels (clickable too!)
    if (labelCandidates.length > 0) {
      ctx.font = '600 12px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const placedRects: Array<{x: number; y: number; w: number; h: number}> = [];

      // Priority labels first
      labelCandidates.sort((a, b) => Number(b.priority) - Number(a.priority));

      for (const item of labelCandidates) {
        const text = item.station.name.length > 22 ? `${item.station.name.slice(0, 21)}…` : item.station.name;
        const textW = ctx.measureText(text).width;
        const padX = 8;
        const boxW = textW + padX * 2;
        const boxH = 24;
        const boxX = item.x + 12;
        const boxY = item.y - boxH / 2;

        if (boxX + boxW > this.width - 8 || boxY < 8 || boxY + boxH > this.height - 8) continue;

        const overlaps = placedRects.some(
          (r) => !(boxX + boxW + 4 < r.x || boxX > r.x + r.w + 4 || boxY + boxH + 4 < r.y || boxY > r.y + r.h + 4)
        );
        if (overlaps && !item.priority) continue;

        placedRects.push({x: boxX, y: boxY, w: boxW, h: boxH});

        const isPlaying = item.station.stationuuid === this.playingId;
        const isSelected = item.station.stationuuid === this.selectedId;

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        if (this.theme === 'dark') {
          ctx.fillStyle = isPlaying ? '#332e22' : isSelected ? '#2a374d' : 'rgba(36, 44, 60, 0.92)';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = isPlaying ? '#fde68a' : isSelected ? '#93c5fd' : '#343e52';
          ctx.stroke();
          ctx.fillStyle = isPlaying ? '#fde68a' : '#f1f5f9';
        } else {
          ctx.fillStyle = isPlaying ? '#fffbeb' : isSelected ? '#f0f9ff' : 'rgba(255, 255, 255, 0.94)';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = isPlaying ? '#f59e0b' : isSelected ? '#38bdf8' : 'rgba(203, 213, 225, 0.9)';
          ctx.stroke();
          ctx.fillStyle = '#0f172a';
        }

        ctx.fillText(text, boxX + padX, item.y);
        this.labelHitboxes.push({station: item.station, x: boxX, y: boxY, w: boxW, h: boxH});
      }
    }

    ctx.restore();
  }

  public destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.container.innerHTML = '';
  }
}
