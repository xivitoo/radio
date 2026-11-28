import type {Station} from '../types';
import {isUsableFavicon} from '../utils/stationAvatar';

const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';
const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

interface CastDevice {
  friendlyName?: string;
}

interface CastSession {
  getCastDevice: () => CastDevice;
  loadMedia: (request: unknown) => Promise<unknown>;
  endSession: (stopCasting: boolean) => void;
}

interface CastContext {
  setOptions: (options: {receiverApplicationId: string; autoJoinPolicy: string}) => void;
  getCurrentSession: () => CastSession | null;
  getCastState: () => string;
  requestSession: () => Promise<void>;
  addEventListener: (eventType: string, handler: (event: {sessionState?: string; castState?: string}) => void) => void;
}

interface RemotePlayer {
  isConnected: boolean;
  isPaused: boolean;
}

interface RemotePlayerController {
  playOrPause: () => void;
}

interface CastWindow extends Window {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: {
    framework: {
      CastContext: {getInstance: () => CastContext};
      CastContextEventType: {
        SESSION_STATE_CHANGED: string;
        CAST_STATE_CHANGED: string;
      };
      SessionState: {
        SESSION_STARTED: string;
        SESSION_RESUMED: string;
        SESSION_ENDED: string;
      };
      RemotePlayer: new () => RemotePlayer;
      RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy: {ORIGIN_SCOPED: string};
      Image: new (url: string) => unknown;
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID?: string;
        StreamType: {LIVE: string};
        MediaInfo: new (contentId: string, contentType: string) => {
          metadata: unknown;
          streamType: string;
        };
        MusicTrackMediaMetadata: new () => {
          title?: string;
          artist?: string;
          albumName?: string;
          images?: unknown[];
        };
        LoadRequest: new (mediaInfo: unknown) => {
          autoplay: boolean;
        };
      };
    };
  };
}

export interface CastStateSnapshot {
  connected: boolean;
  connecting: boolean;
  isPaused: boolean;
  deviceName: string | null;
  castingStationId: string | null;
}

export interface CastActionResult {
  ok: boolean;
  message?: string;
  paused?: boolean;
}

function getContentType(station: Station, streamUrl: string): string {
  const codec = (station.codec || '').toUpperCase();
  const lower = streamUrl.toLowerCase();
  if (/\.m3u8(\?|$)/i.test(lower) || codec === 'HLS') return 'application/x-mpegurl';
  if (codec.includes('AAC')) return 'audio/aac';
  if (codec.includes('OGG') || codec.includes('OPUS')) return 'audio/ogg';
  return 'audio/mpeg';
}

export class CastService {
  private sdkLoadPromise: Promise<boolean> | null = null;
  private initialized = false;
  private remotePlayer: RemotePlayer | null = null;
  private remoteController: RemotePlayerController | null = null;

  private state: CastStateSnapshot = {
    connected: false,
    connecting: false,
    isPaused: false,
    deviceName: null,
    castingStationId: null,
  };

  private onChange: (state: CastStateSnapshot) => void;

  constructor(onChange: (state: CastStateSnapshot) => void) {
    this.onChange = onChange;
  }

  public getState(): CastStateSnapshot {
    return {...this.state};
  }

  public isConnected(): boolean {
    return this.state.connected;
  }

  public async castStation(station: Station, audioEl?: HTMLAudioElement): Promise<CastActionResult> {
    const win = window as CastWindow;
    this.state.connecting = true;
    this.emit();

    const sdkReady = await this.ensureSdkLoaded();

    if (sdkReady && win.cast?.framework && win.chrome?.cast) {
      try {
        const context = win.cast.framework.CastContext.getInstance();
        let session = context.getCurrentSession();

        if (!session) {
          await context.requestSession();
          session = context.getCurrentSession();
        } else if (this.state.castingStationId === station.stationuuid) {
          // Already casting this station: open native Cast dialog to adjust volume or disconnect
          await context.requestSession();
          this.syncFromContext();
          return {ok: true};
        }

        if (!session) {
          this.state.connecting = false;
          this.emit();
          return {ok: false};
        }

        const streamUrl = station.url_resolved || station.url;
        const contentType = getContentType(station, streamUrl);
        const mediaInfo = new win.chrome.cast.media.MediaInfo(streamUrl, contentType);
        mediaInfo.streamType = win.chrome.cast.media.StreamType.LIVE;

        const metadata = new win.chrome.cast.media.MusicTrackMediaMetadata();
        metadata.title = station.name;
        metadata.artist = [station.state, station.country].filter(Boolean).join(', ') || 'Radio en directo';
        metadata.albumName = 'Radio by XivIoT';

        const safeFavicon = isUsableFavicon(station.favicon);
        const fallbackLogo = new URL(`${BASE_URL}pwa-512x512.png`, window.location.origin).href;
        metadata.images = [new win.chrome.cast.Image(safeFavicon || fallbackLogo)];
        mediaInfo.metadata = metadata;

        const request = new win.chrome.cast.media.LoadRequest(mediaInfo);
        request.autoplay = true;

        await session.loadMedia(request);

        this.state = {
          connected: true,
          connecting: false,
          isPaused: false,
          deviceName: session.getCastDevice()?.friendlyName || 'Google Nest / TV',
          castingStationId: station.stationuuid,
        };
        this.emit();
        return {ok: true};
      } catch (err) {
        this.state.connecting = false;
        this.syncFromContext();
        const code = typeof err === 'string' ? err : (err as {code?: string})?.code;
        if (code === 'cancel') {
          return {ok: false};
        }
        return {
          ok: false,
          message: 'No se encontraron dispositivos Google Nest o TV en tu red Wi-Fi.',
        };
      }
    }

    // Fallback: HTML5 RemotePlayback if supported by browser
    this.state.connecting = false;
    this.emit();
    if (audioEl) {
      const remote = (audioEl as HTMLAudioElement & {remote?: {prompt?: () => Promise<void>}}).remote;
      if (remote && typeof remote.prompt === 'function') {
        try {
          await remote.prompt();
          return {ok: true};
        } catch (err) {
          const name = (err as {name?: string})?.name;
          if (name === 'NotAllowedError' || name === 'AbortError') {
            return {ok: false};
          }
        }
      }
    }

    return {
      ok: false,
      message: 'Abre la web en Chrome o Android conectado al mismo Wi-Fi que tu Google Nest o TV.',
    };
  }

  public togglePlayPause(): boolean {
    if (!this.state.connected || !this.remoteController || !this.remotePlayer) {
      return false;
    }
    this.remoteController.playOrPause();
    this.state.isPaused = Boolean(this.remotePlayer.isPaused);
    this.emit();
    return true;
  }

  public stopCasting(): void {
    const win = window as CastWindow;
    const session = win.cast?.framework?.CastContext.getInstance().getCurrentSession();
    if (session) {
      try {
        session.endSession(true);
      } catch {
        // Ignore endSession errors
      }
    }
    this.state = {
      connected: false,
      connecting: false,
      isPaused: false,
      deviceName: null,
      castingStationId: null,
    };
    this.emit();
  }

  private ensureSdkLoaded(): Promise<boolean> {
    const win = window as CastWindow;
    if (win.cast?.framework && win.chrome?.cast) {
      this.initializeContext();
      return Promise.resolve(true);
    }

    if (this.sdkLoadPromise) {
      return this.sdkLoadPromise;
    }

    this.sdkLoadPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (available: boolean) => {
        if (settled) return;
        settled = true;
        if (available) {
          this.initializeContext();
        }
        resolve(available);
      };

      const timeoutId = window.setTimeout(() => finish(false), 5000);

      const prevHook = win.__onGCastApiAvailable;
      win.__onGCastApiAvailable = (isAvailable: boolean) => {
        window.clearTimeout(timeoutId);
        if (typeof prevHook === 'function') {
          try {
            prevHook(isAvailable);
          } catch {
            // Ignore previous hook errors
          }
        }
        finish(Boolean(isAvailable && win.cast?.framework));
      };

      if (!document.querySelector(`script[src="${CAST_SDK_URL}"]`)) {
        const script = document.createElement('script');
        script.src = CAST_SDK_URL;
        script.async = true;
        script.onerror = () => {
          window.clearTimeout(timeoutId);
          finish(false);
        };
        document.head.appendChild(script);
      }
    });

    return this.sdkLoadPromise;
  }

  private initializeContext(): void {
    if (this.initialized) return;
    const win = window as CastWindow;
    if (!win.cast?.framework || !win.chrome?.cast) return;

    try {
      const context = win.cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId:
          win.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID || DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });

      this.remotePlayer = new win.cast.framework.RemotePlayer();
      this.remoteController = new win.cast.framework.RemotePlayerController(this.remotePlayer);

      const {SESSION_STATE_CHANGED, CAST_STATE_CHANGED} = win.cast.framework.CastContextEventType;
      context.addEventListener(SESSION_STATE_CHANGED, () => this.syncFromContext());
      context.addEventListener(CAST_STATE_CHANGED, () => this.syncFromContext());
      this.initialized = true;
      this.syncFromContext();
    } catch {
      // Ignore Cast initialization failure in unsupported contexts
    }
  }

  private syncFromContext(): void {
    const win = window as CastWindow;
    const session = win.cast?.framework?.CastContext.getInstance().getCurrentSession();
    if (session) {
      this.state = {
        connected: true,
        connecting: false,
        isPaused: Boolean(this.remotePlayer?.isPaused),
        deviceName: session.getCastDevice()?.friendlyName || 'Google Nest / TV',
        castingStationId: this.state.castingStationId,
      };
    } else {
      this.state = {
        connected: false,
        connecting: false,
        isPaused: false,
        deviceName: null,
        castingStationId: null,
      };
    }
    this.emit();
  }

  private emit(): void {
    this.onChange(this.getState());
  }
}
