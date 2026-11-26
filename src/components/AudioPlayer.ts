import {pingStationClick} from '../services/radioService';
import {getSavedVolume, saveVolume} from '../services/storage';
import type {PlayerStatus, Station} from '../types';
import {escapeHtml, sanitizeExternalUrl} from '../utils/geo';
import {icons} from '../utils/icons';

const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

export interface AudioPlayerCallbacks {
  onStatusChange: (status: PlayerStatus, station: Station | null, errorMsg?: string) => void;
  onTryAnotherStation: () => void;
  onSelectStation: (station: Station) => void;
}

export class AudioPlayerController {
  private audio: HTMLAudioElement;
  private currentStation: Station | null = null;
  private status: PlayerStatus = 'idle';
  private errorMessage = '';
  private volume: number;
  private muted = false;

  private connectTimer: number | null = null;
  private sleepEndTime: number | null = null;
  private sleepInterval: number | null = null;
  private sleepMinutes: number | null = null;

  private miniRoot: HTMLElement;
  private waveCanvas: HTMLCanvasElement | null = null;
  private waveRaf: number | null = null;
  private wavePhase = 0;

  private callbacks: AudioPlayerCallbacks;

  constructor(miniRoot: HTMLElement, callbacks: AudioPlayerCallbacks) {
    this.miniRoot = miniRoot;
    this.callbacks = callbacks;
    this.volume = getSavedVolume();

    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.volume = this.volume;

    this.bindAudioEvents();
    this.bindMediaSession();
  }

  public getCurrentStation(): Station | null {
    return this.currentStation;
  }

  public getStatus(): PlayerStatus {
    return this.status;
  }

  public playStation(station: Station): void {
    const isSame = this.currentStation?.stationuuid === station.stationuuid;
    if (isSame && (this.status === 'playing' || this.status === 'connecting')) {
      this.pause();
      return;
    }

    this.clearConnectTimer();
    this.currentStation = station;
    this.errorMessage = '';
    this.setStatus('connecting');

    this.audio.pause();
    this.audio.src = station.url_resolved || station.url;
    this.audio.load();

    this.updateMediaSessionMetadata(station);
    pingStationClick(station.stationuuid);

    this.connectTimer = window.setTimeout(() => {
      if (this.status === 'connecting') {
        this.audio.pause();
        this.setStatus('error', 'La emisora tarda demasiado en responder');
      }
    }, 13000);

    const playPromise = this.audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        if (err && err.name === 'AbortError') return;
        this.clearConnectTimer();
        this.setStatus('error', 'Emisora no disponible o bloqueada');
      });
    }
  }

  public togglePlayPause(): void {
    if (!this.currentStation) return;
    if (this.status === 'playing' || this.status === 'connecting') {
      this.pause();
    } else if (this.status === 'paused' || this.status === 'error') {
      this.resume();
    }
  }

  public resume(): void {
    if (!this.currentStation) return;
    this.clearConnectTimer();
    this.errorMessage = '';
    this.setStatus('connecting');
    if (!this.audio.src || this.status === 'error') {
      this.audio.src = this.currentStation.url_resolved || this.currentStation.url;
      this.audio.load();
    }
    this.connectTimer = window.setTimeout(() => {
      if (this.status === 'connecting') {
        this.audio.pause();
        this.setStatus('error', 'Emisora no disponible');
      }
    }, 13000);

    this.audio.play().catch((err) => {
      if (err && err.name === 'AbortError') return;
      this.clearConnectTimer();
      this.setStatus('error', 'No se pudo reanudar la emisión');
    });
  }

  public pause(): void {
    this.clearConnectTimer();
    this.audio.pause();
    if (this.currentStation) {
      this.setStatus('paused');
    } else {
      this.setStatus('idle');
    }
  }

  public setSleepTimer(minutes: number | null): void {
    if (this.sleepInterval !== null) {
      window.clearInterval(this.sleepInterval);
      this.sleepInterval = null;
    }

    if (!minutes || this.sleepMinutes === minutes) {
      this.sleepMinutes = null;
      this.sleepEndTime = null;
      this.renderMiniPlayer();
      return;
    }

    this.sleepMinutes = minutes;
    this.sleepEndTime = Date.now() + minutes * 60 * 1000;
    this.sleepInterval = window.setInterval(() => {
      if (!this.sleepEndTime) return;
      const remaining = this.sleepEndTime - Date.now();
      if (remaining <= 0) {
        this.pause();
        this.setSleepTimer(null);
      } else {
        this.updateSleepBadge();
      }
    }, 1000);
    this.renderMiniPlayer();
  }

  private bindAudioEvents(): void {
    this.audio.addEventListener('playing', () => {
      this.clearConnectTimer();
      this.errorMessage = '';
      this.setStatus('playing');
    });

    this.audio.addEventListener('waiting', () => {
      if (this.currentStation && this.status === 'playing') {
        this.setStatus('connecting');
      }
    });

    this.audio.addEventListener('pause', () => {
      if (this.status === 'playing' || this.status === 'connecting') {
        this.clearConnectTimer();
        this.setStatus('paused');
      }
    });

    this.audio.addEventListener('error', () => {
      this.clearConnectTimer();
      if (!this.currentStation) return;
      this.setStatus('error', 'Emisora no disponible');
    });
  }

  private bindMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => this.resume());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('stop', () => this.pause());
    } catch {
      // Ignore unsupported handlers
    }
  }

  private updateMediaSessionMetadata(station: Station): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const safeFavicon = sanitizeExternalUrl(station.favicon);
    const fallbackIcon = new URL(`${BASE_URL}pwa-192x192.png`, window.location.origin).href;
    const artworkUrl = safeFavicon && safeFavicon.startsWith('https://') ? safeFavicon : fallbackIcon;
    const subtitle = [station.state, station.country].filter(Boolean).join(', ') || 'Radio en directo';

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: subtitle,
        album: 'Radio by XivIoT',
        artwork: [
          {src: artworkUrl, sizes: '192x192', type: 'image/png'},
          {src: fallbackIcon, sizes: '512x512', type: 'image/png'},
        ],
      });
    } catch {
      // Ignore metadata errors
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private setStatus(status: PlayerStatus, errorMsg = ''): void {
    this.status = status;
    this.errorMessage = errorMsg;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState =
        status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
    }
    this.renderMiniPlayer();
    this.callbacks.onStatusChange(status, this.currentStation, errorMsg);
  }

  private updateSleepBadge(): void {
    const el = this.miniRoot.querySelector('[data-sleep-remaining]');
    if (!el || !this.sleepEndTime) return;
    const secs = Math.max(0, Math.ceil((this.sleepEndTime - Date.now()) / 1000));
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    el.textContent = `${mins}:${String(rem).padStart(2, '0')}`;
  }

  public renderMiniPlayer(): void {
    if (!this.currentStation) {
      this.stopWaveAnimation();
      this.miniRoot.innerHTML = '';
      this.miniRoot.classList.add('hidden');
      return;
    }

    this.miniRoot.classList.remove('hidden');
    const st = this.currentStation;
    const isPlaying = this.status === 'playing';
    const isConnecting = this.status === 'connecting';
    const isError = this.status === 'error';

    const statusLabel = isPlaying
      ? 'En directo'
      : isConnecting
        ? 'Conectando…'
        : isError
          ? 'Emisora no disponible'
          : 'En pausa';

    const statusColor = isPlaying
      ? 'text-emerald-700 dark:text-[#6ee7b7]'
      : isConnecting
        ? 'text-amber-700 dark:text-[#fde68a]'
        : isError
          ? 'text-rose-700 dark:text-[#fda4af]'
          : 'text-slate-500 dark:text-slate-400';

    const safeFav = sanitizeExternalUrl(st.favicon);
    const avatarHtml = safeFav
      ? `<img src="${escapeHtml(safeFav)}" alt="" referrerpolicy="no-referrer" class="w-10 h-10 rounded-xl object-cover bg-slate-100 dark:bg-[#2a3346] shrink-0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="hidden w-10 h-10 rounded-xl bg-emerald-50 dark:bg-[#2a3346] text-emerald-700 dark:text-[#6ee7b7] items-center justify-center shrink-0">${icons.radio('w-5 h-5')}</div>`
      : `<div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-[#2a3346] text-emerald-700 dark:text-[#6ee7b7] flex items-center justify-center shrink-0">${icons.radio('w-5 h-5')}</div>`;

    const remainingText =
      this.sleepEndTime !== null
        ? `${Math.floor(Math.max(0, Math.ceil((this.sleepEndTime - Date.now()) / 1000)) / 60)}:${String(
            Math.max(0, Math.ceil((this.sleepEndTime - Date.now()) / 1000)) % 60
          ).padStart(2, '0')}`
        : '';

    this.miniRoot.innerHTML = `
      <div class="rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-lg p-3 transition-colors">
        <div class="flex items-center gap-3">
          <button type="button" data-action="open-detail" class="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-xl p-1 -m-1 hover:bg-slate-50 dark:hover:bg-[#2a3346] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors">
            ${avatarHtml}
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">${escapeHtml(st.name)}</div>
              <div class="flex items-center gap-2 text-xs ${statusColor}">
                <span class="truncate font-medium">${escapeHtml(statusLabel)}</span>
                ${st.bitrate > 0 ? `<span aria-hidden="true" class="text-slate-400">·</span><span class="font-mono-num text-slate-500 dark:text-slate-400">${st.bitrate} kbps</span>` : ''}
              </div>
            </div>
          </button>

          <canvas data-wave-canvas width="56" height="26" class="hidden sm:block shrink-0" aria-hidden="true"></canvas>

          <button type="button" data-action="toggle-play" aria-label="${isPlaying || isConnecting ? 'Pausar emisora' : 'Reproducir emisora'}" class="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 dark:bg-[#6ee7b7] dark:text-[#1e2432] dark:hover:bg-[#5cd8a8] dark:active:bg-[#4ac998] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors shrink-0">
            ${
              isConnecting
                ? `<span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spinner"></span>`
                : isPlaying
                  ? icons.pause('w-5 h-5')
                  : icons.play('w-5 h-5')
            }
          </button>
        </div>

        ${
          isError
            ? `<div class="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-rose-50 dark:bg-[#332732] px-3 py-2 text-xs text-rose-800 dark:text-[#fda4af]">
                <span class="truncate">${escapeHtml(this.errorMessage || 'Emisora no disponible')}</span>
                <button type="button" data-action="try-another" class="shrink-0 font-semibold underline hover:no-underline px-2 py-1 rounded-lg hover:bg-rose-100 dark:hover:bg-[#3f2e3c] focus-visible:outline-none">Probar otra</button>
              </div>`
            : ''
        }

        <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-[#343e52] flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <button type="button" data-action="toggle-mute" aria-label="${this.muted || this.volume === 0 ? 'Activar sonido' : 'Silenciar'}" class="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2a3346] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors">
              ${this.muted || this.volume === 0 ? icons.mute('w-4 h-4') : icons.volume('w-4 h-4')}
            </button>
            <input type="range" data-action="volume" min="0" max="1" step="0.02" value="${this.muted ? 0 : this.volume}" aria-label="Volumen" class="w-20 sm:w-24 accent-emerald-700 dark:accent-[#6ee7b7] cursor-pointer" />
          </div>

          <div class="flex items-center gap-1" role="group" aria-label="Temporizador de apagado">
            <span class="text-slate-400 dark:text-slate-400 mr-0.5">${icons.timer('w-3.5 h-3.5')}</span>
            ${
              remainingText
                ? `<span data-sleep-remaining class="font-mono-num text-[11px] font-medium text-amber-700 dark:text-[#fde68a] mr-1">${remainingText}</span>`
                : ''
            }
            ${[15, 30, 60]
              .map((min) => {
                const active = this.sleepMinutes === min;
                return `<button type="button" data-sleep="${min}" class="px-2 py-1 text-[11px] font-mono-num font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
                  active
                    ? 'bg-amber-100 text-amber-900 dark:bg-[#3a3529] dark:text-[#fde68a]'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2a3346]'
                }">${min}m</button>`;
              })
              .join('')}
          </div>
        </div>
      </div>
    `;

    this.bindMiniEvents();
    this.waveCanvas = this.miniRoot.querySelector('[data-wave-canvas]');
    if (isPlaying) {
      this.startWaveAnimation();
    } else {
      this.stopWaveAnimation();
      this.drawWaveFrame(false);
    }
  }

  private bindMiniEvents(): void {
    this.miniRoot.querySelector('[data-action="open-detail"]')?.addEventListener('click', () => {
      if (this.currentStation) this.callbacks.onSelectStation(this.currentStation);
    });
    this.miniRoot.querySelector('[data-action="toggle-play"]')?.addEventListener('click', () => {
      this.togglePlayPause();
    });
    this.miniRoot.querySelector('[data-action="try-another"]')?.addEventListener('click', () => {
      this.callbacks.onTryAnotherStation();
    });
    this.miniRoot.querySelector('[data-action="toggle-mute"]')?.addEventListener('click', () => {
      this.muted = !this.muted;
      this.audio.muted = this.muted;
      this.renderMiniPlayer();
    });

    const volInput = this.miniRoot.querySelector('[data-action="volume"]') as HTMLInputElement | null;
    volInput?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      this.volume = val;
      this.muted = val === 0;
      this.audio.volume = val;
      this.audio.muted = this.muted;
      saveVolume(val);
    });

    this.miniRoot.querySelectorAll('[data-sleep]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const min = Number((btn as HTMLElement).dataset.sleep);
        this.setSleepTimer(min);
      });
    });
  }

  private startWaveAnimation(): void {
    if (this.waveRaf !== null) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      this.drawWaveFrame(true);
      return;
    }
    const tick = () => {
      this.wavePhase += 0.14;
      this.drawWaveFrame(true);
      this.waveRaf = requestAnimationFrame(tick);
    };
    this.waveRaf = requestAnimationFrame(tick);
  }

  private stopWaveAnimation(): void {
    if (this.waveRaf !== null) {
      cancelAnimationFrame(this.waveRaf);
      this.waveRaf = null;
    }
  }

  private drawWaveFrame(active: boolean): void {
    const canvas = this.waveCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const isDark = document.documentElement.classList.contains('dark');
    ctx.fillStyle = active
      ? isDark
        ? '#6ee7b7'
        : '#047857'
      : isDark
        ? '#475569'
        : '#cbd5e1';

    const bars = 9;
    const barW = 3;
    const gap = 3;
    const startX = (w - (bars * barW + (bars - 1) * gap)) / 2;

    for (let i = 0; i < bars; i++) {
      const amp = active ? 0.35 + 0.65 * Math.abs(Math.sin(this.wavePhase + i * 0.72)) : 0.2;
      const barH = Math.max(4, Math.round(amp * (h - 4)));
      const x = startX + i * (barW + gap);
      const y = (h - barH) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    }
  }
}
