import Hls from 'hls.js';
import {type CastStateSnapshot, CastService} from '../services/castService';
import {pingStationClick} from '../services/radioService';
import {getSavedVolume, saveVolume} from '../services/storage';
import type {PlayerStatus, Station} from '../types';
import {escapeHtml} from '../utils/geo';
import {icons} from '../utils/icons';
import {isUsableFavicon, renderStationAvatar} from '../utils/stationAvatar';

const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

export interface AudioPlayerCallbacks {
  onStatusChange: (status: PlayerStatus, station: Station | null, errorMsg?: string) => void;
  onCastStateChange?: () => void;
  onTryAnotherStation: () => void;
  onSelectStation: (station: Station) => void;
}

export class AudioPlayerController {
  private audio: HTMLAudioElement;
  private hls: Hls | null = null;
  private currentStation: Station | null = null;
  private status: PlayerStatus = 'idle';
  private errorMessage = '';
  private volume: number;
  private muted = false;
  private triedFallbackUrl = false;

  private connectTimer: number | null = null;
  private sleepEndTime: number | null = null;
  private sleepInterval: number | null = null;
  private sleepMinutes: number | null = null;

  private miniRoot: HTMLElement;
  private waveCanvas: HTMLCanvasElement | null = null;
  private waveRaf: number | null = null;
  private wavePhase = 0;

  private callbacks: AudioPlayerCallbacks;
  private castService: CastService;
  private castState: CastStateSnapshot = {
    connected: false,
    connecting: false,
    isPaused: false,
    deviceName: null,
    castingStationId: null,
  };
  private castHint = '';

  constructor(miniRoot: HTMLElement, callbacks: AudioPlayerCallbacks) {
    this.miniRoot = miniRoot;
    this.callbacks = callbacks;
    this.volume = getSavedVolume();

    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.volume = this.volume;

    this.castService = new CastService((nextCastState) => {
      const wasConnected = this.castState.connected;
      this.castState = nextCastState;
      if (wasConnected && !nextCastState.connected && this.currentStation && this.status === 'playing' && !this.audio.src) {
        this.setStatus('paused');
      } else {
        this.renderMiniPlayer();
      }
      this.callbacks.onCastStateChange?.();
    });

    this.bindAudioEvents();
    this.bindMediaSession();
  }

  public getCurrentStation(): Station | null {
    return this.currentStation;
  }

  public getStatus(): PlayerStatus {
    return this.status;
  }

  public getCastState(): CastStateSnapshot {
    return {...this.castState};
  }

  public getCastHint(): string {
    return this.castHint;
  }

  public clearCastHint(): void {
    this.castHint = '';
    this.renderMiniPlayer();
    this.callbacks.onCastStateChange?.();
  }

  public async castStation(station?: Station): Promise<void> {
    const target = station || this.currentStation;
    if (!target) return;

    this.castHint = '';
    if (this.currentStation?.stationuuid !== target.stationuuid) {
      this.currentStation = target;
      this.updateMediaSessionMetadata(target);
      pingStationClick(target.stationuuid);
    }

    this.renderMiniPlayer();
    this.callbacks.onCastStateChange?.();

    const result = await this.castService.castStation(target, this.audio);
    if (result.ok) {
      this.clearConnectTimer();
      this.resetAudioElement();
      this.errorMessage = '';
      this.setStatus('playing');
    } else if (result.message) {
      this.castHint = result.message;
      this.renderMiniPlayer();
      this.callbacks.onCastStateChange?.();
    }
  }

  public playStation(station: Station): void {
    const isSame = this.currentStation?.stationuuid === station.stationuuid;
    if (isSame && (this.status === 'playing' || this.status === 'connecting')) {
      this.pause();
      return;
    }

    if (this.castState.connected) {
      this.castService.stopCasting();
    }

    this.castHint = '';
    this.triedFallbackUrl = false;
    this.currentStation = station;
    this.errorMessage = '';
    this.updateMediaSessionMetadata(station);
    pingStationClick(station.stationuuid);

    const primaryUrl = station.url_resolved || station.url;
    this.startStream(primaryUrl);
  }

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  private resetAudioElement(): void {
    this.destroyHls();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  private startStream(streamUrl: string): void {
    this.clearConnectTimer();
    this.resetAudioElement();
    this.setStatus('connecting');

    this.connectTimer = window.setTimeout(() => {
      if (this.status === 'connecting') {
        this.handleStreamFailure('La emisora tarda demasiado en responder');
      }
    }, 12000);

    const isHls = /\.m3u8(\?|$)/i.test(streamUrl) || this.currentStation?.codec === 'HLS';
    const nativeHls = this.audio.canPlayType('application/vnd.apple.mpegurl') !== '';

    if (isHls && !nativeHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 1,
      });
      this.hls = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (this.hls !== hls) return;
        this.audio.play().catch((err) => {
          if (err && err.name === 'AbortError') return;
          this.handleStreamFailure('Emisora no disponible');
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (this.hls !== hls) return;
        if (data.fatal) {
          this.handleStreamFailure('Emisora no disponible');
        }
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(this.audio);
      return;
    }

    this.audio.src = streamUrl;
    this.audio.load();
    const playPromise = this.audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        if (err && err.name === 'AbortError') return;
        this.handleStreamFailure('Emisora no disponible');
      });
    }
  }

  private handleStreamFailure(reason: string): void {
    this.clearConnectTimer();
    const st = this.currentStation;
    const altUrl = st?.url?.trim();
    const isHttpsPage = window.location.protocol === 'https:';

    if (
      st &&
      !this.triedFallbackUrl &&
      altUrl &&
      altUrl !== st.url_resolved &&
      (!isHttpsPage || altUrl.startsWith('https://')) &&
      !/\.(pls|m3u)(\?|$)/i.test(altUrl)
    ) {
      this.triedFallbackUrl = true;
      this.startStream(altUrl);
      return;
    }

    this.resetAudioElement();
    this.setStatus('error', reason);
  }

  public togglePlayPause(): void {
    if (!this.currentStation) return;
    if (this.castState.connected && this.castState.castingStationId === this.currentStation.stationuuid) {
      if (this.castService.togglePlayPause()) {
        this.setStatus(this.castState.isPaused ? 'paused' : 'playing');
        return;
      }
    }
    if (this.status === 'playing' || this.status === 'connecting') {
      this.pause();
    } else if (this.status === 'paused' || this.status === 'error') {
      this.resume();
    }
  }

  public resume(): void {
    if (!this.currentStation) return;
    if (this.castState.connected && this.castState.castingStationId === this.currentStation.stationuuid) {
      if (this.castState.isPaused && this.castService.togglePlayPause()) {
        this.setStatus('playing');
      }
      return;
    }
    this.triedFallbackUrl = false;
    this.errorMessage = '';
    if (this.hls || !this.audio.src || this.status === 'error') {
      this.startStream(this.currentStation.url_resolved || this.currentStation.url);
      return;
    }

    this.clearConnectTimer();
    this.setStatus('connecting');
    this.connectTimer = window.setTimeout(() => {
      if (this.status === 'connecting') {
        this.handleStreamFailure('Emisora no disponible');
      }
    }, 12000);

    this.audio.play().catch((err) => {
      if (err && err.name === 'AbortError') return;
      this.handleStreamFailure('No se pudo reanudar la emisión');
    });
  }

  public pause(): void {
    if (this.castState.connected && this.currentStation && this.castState.castingStationId === this.currentStation.stationuuid) {
      if (!this.castState.isPaused && this.castService.togglePlayPause()) {
        this.setStatus('paused');
        return;
      }
    }
    this.clearConnectTimer();
    this.destroyHls();
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
      if (!this.currentStation || this.status === 'idle' || this.status === 'paused' || this.status === 'error') {
        return;
      }
      this.handleStreamFailure('Emisora no disponible');
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
    const safeFavicon = isUsableFavicon(station.favicon);
    const fallbackIcon = new URL(`${BASE_URL}pwa-192x192.png`, window.location.origin).href;
    const artworkUrl = safeFavicon || fallbackIcon;
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
    const isCastingThis = this.castState.connected && this.castState.castingStationId === st.stationuuid;
    const isPlaying = isCastingThis ? !this.castState.isPaused : this.status === 'playing';
    const isConnecting = this.castState.connecting || (!isCastingThis && this.status === 'connecting');
    const isError = !isCastingThis && this.status === 'error';

    const statusLabel = isCastingThis
      ? `${this.castState.isPaused ? 'En pausa · ' : ''}${this.castState.deviceName || 'Google Nest / TV'}`
      : isPlaying
        ? 'En directo'
        : isConnecting
          ? 'Conectando…'
          : isError
            ? 'Emisora no disponible'
            : 'En pausa';

    const statusColor = isCastingThis
      ? 'text-sky-700 dark:text-[#93c5fd]'
      : isPlaying
        ? 'text-emerald-700 dark:text-[#6ee7b7]'
        : isConnecting
          ? 'text-amber-700 dark:text-[#fde68a]'
          : isError
            ? 'text-rose-700 dark:text-[#fda4af]'
            : 'text-slate-500 dark:text-slate-400';

    const avatarHtml = renderStationAvatar(st, 'w-10 h-10', true);

    const remainingText =
      this.sleepEndTime !== null
        ? `${Math.floor(Math.max(0, Math.ceil((this.sleepEndTime - Date.now()) / 1000)) / 60)}:${String(
            Math.max(0, Math.ceil((this.sleepEndTime - Date.now()) / 1000)) % 60
          ).padStart(2, '0')}`
        : '';

    this.miniRoot.innerHTML = `
      <div class="rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-lg p-3 transition-colors">
        <div class="flex items-center gap-2.5">
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

          <button
            type="button"
            data-action="cast-current"
            aria-label="Enviar a Google Nest / TV"
            title="Enviar a Google Nest / TV"
            class="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
              isCastingThis
                ? 'bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-[#253549] dark:text-[#93c5fd] dark:hover:bg-[#2d415a]'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 dark:bg-[#2a3346] dark:text-slate-200 dark:hover:bg-[#313c52] dark:active:bg-[#38445c]'
            }"
          >
            ${icons.cast('w-4 h-4')}
          </button>

          <button type="button" data-action="toggle-play" aria-label="${isPlaying || isConnecting ? 'Pausar emisora' : 'Reproducir emisora'}" class="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center bg-emerald-700 text-white hover:bg-emerald-800 active:scale-[0.97] active:bg-emerald-900 dark:bg-[#6ee7b7] dark:text-[#1e2432] dark:hover:bg-[#5cd8a8] dark:active:bg-[#4ac998] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-all shrink-0">
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

        ${
          this.castHint
            ? `<div class="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-sky-50 dark:bg-[#253042] px-3 py-2 text-xs text-sky-900 dark:text-[#93c5fd]">
                <span class="leading-snug">${escapeHtml(this.castHint)}</span>
                <button type="button" data-action="dismiss-cast-hint" aria-label="Cerrar aviso" class="shrink-0 p-1 rounded-lg hover:bg-sky-100 dark:hover:bg-[#314059] focus-visible:outline-none">
                  ${icons.x('w-3.5 h-3.5')}
                </button>
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
    this.miniRoot.querySelector('[data-action="cast-current"]')?.addEventListener('click', () => {
      void this.castStation();
    });
    this.miniRoot.querySelector('[data-action="dismiss-cast-hint"]')?.addEventListener('click', () => {
      this.clearCastHint();
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
