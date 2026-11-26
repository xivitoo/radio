import './index.css';
import {AudioPlayerController} from './components/AudioPlayer';
import {CanvasMap} from './components/CanvasMap';
import {CountryPickerModal} from './components/CountryPickerModal';
import {PWAInstallManager} from './components/PWAInstallManager';
import {type PanelActions, type PanelViewState, renderPanelContent} from './components/StationPanelContent';
import {COUNTRY_CENTROIDS, FEATURED_COUNTRIES, countryCodeToFlag} from './constants';
import {
  fetchStationByUuid,
  loadCountriesList,
  loadCountryStationsOnlineFirst,
  loadOfflineBackupStations,
} from './services/radioService';
import {
  getFavoritesMap,
  getRecentStations,
  getSavedCountry,
  getSavedTheme,
  pushRecentStation,
  saveFavoritesMap,
  saveSelectedCountry,
  saveTheme,
} from './services/storage';
import type {
  CategoryFilter,
  ConnectionMode,
  CountryItem,
  FavoriteEntry,
  PlayerStatus,
  SheetHeight,
  SortMode,
  Station,
  TabId,
  ThemeMode,
  UserLocation,
} from './types';
import {escapeHtml} from './utils/geo';
import {icons} from './utils/icons';
import {renderAppLogo, renderSplashIcon} from './utils/logo';

const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

// Service Worker registration strictly in production; unregister in dev
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${BASE_URL}sw.js`, {scope: BASE_URL}).catch(() => undefined);
    });
  } else {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => undefined);
  }
}

class RadioApp {
  private root: HTMLElement;
  private theme: ThemeMode;
  private countries: CountryItem[] = [...FEATURED_COUNTRIES];
  private selectedCountryCode: string | null = getSavedCountry();

  private allStations: Station[] = [];
  private filteredStations: Station[] = [];
  private activeCategory: CategoryFilter = 'all';
  private searchQuery = '';
  private sortMode: SortMode = 'popular';

  private activeTab: TabId = 'explore';
  private selectedStation: Station | null = null;
  private favorites: Record<string, FavoriteEntry> = getFavoritesMap();
  private favoriteTagFilter = 'ALL';
  private recents: Station[] = getRecentStations();
  private connectionMode: ConnectionMode = 'online';
  private userLocation: UserLocation | null = null;
  private sheetHeight: SheetHeight = 'mid';
  private copiedFeedback = false;

  private map!: CanvasMap;
  private player!: AudioPlayerController;
  private countryPicker!: CountryPickerModal;
  private pwaInstall!: PWAInstallManager;

  // DOM refs
  private splashEl!: HTMLElement;
  private desktopContentEl!: HTMLElement;
  private mobileContentEl!: HTMLElement;
  private mobileSheetEl!: HTMLElement;
  private mobileMiniSlot!: HTMLElement;
  private desktopMiniSlot!: HTMLElement;
  private countryBtnEl!: HTMLButtonElement;
  private statusLineEl!: HTMLElement;
  private themeBtnEl!: HTMLButtonElement;
  private gpsBtnEl!: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.theme = getSavedTheme();
    this.applyTheme(this.theme);
    this.buildShell();
    this.initSubsystems();
    this.bootstrap();
  }

  private applyTheme(theme: ThemeMode): void {
    this.theme = theme;
    saveTheme(theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#1e2432' : '#ffffff');
    }
  }

  private buildShell(): void {
    this.root.innerHTML = `
      <div class="relative flex h-dvh w-full overflow-hidden bg-slate-50 dark:bg-[#1e2432] text-slate-900 dark:text-slate-100">
        <!-- Desktop Left Sidebar -->
        <aside class="hidden lg:flex lg:w-[400px] xl:w-[420px] h-full flex-col border-r border-slate-200/80 dark:border-[#343e52] bg-white dark:bg-[#242c3c] shrink-0 z-20">
          <!-- Header: ONLY the app logo -->
          <div class="px-5 py-3.5 border-b border-slate-100 dark:border-[#343e52] shrink-0 flex items-center">
            ${renderAppLogo('h-9 w-auto')}
          </div>

          <div data-desktop-content class="flex-1 min-h-0 native-scroll px-5 py-4"></div>

          <div data-desktop-mini-player class="hidden px-4 pb-3 shrink-0"></div>

          <nav aria-label="Secciones principales" class="grid grid-cols-3 border-t border-slate-200/80 dark:border-[#343e52] bg-white dark:bg-[#242c3c] shrink-0">
            ${this.renderTabButtons('desktop')}
          </nav>
        </aside>

        <!-- Main Map & Top Overlay Area -->
        <main class="relative flex-1 h-full min-w-0 overflow-hidden">
          <div data-map-container class="absolute inset-0"></div>

          <!-- Top Overlay Controls (NO floating logo on map) -->
          <div class="pointer-events-none absolute top-0 left-0 right-0 z-20 p-3 sm:p-4 pt-safe flex flex-col gap-2.5 max-w-2xl">
            <!-- Top Row: Country left, GPS / Theme / Install right -->
            <div class="pointer-events-auto flex items-center justify-between gap-2">
              <button
                type="button"
                data-country-btn
                class="min-h-[44px] px-3.5 py-2 rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-sm flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-[#2a3346] active:bg-slate-100 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors whitespace-nowrap shrink-0"
              >
                <span data-country-flag aria-hidden="true">🌍</span>
                <span data-country-label class="max-w-[140px] sm:max-w-[200px] truncate">Elegir país</span>
                ${icons.chevronDown('w-4 h-4 text-slate-400')}
              </button>

              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-gps-btn
                  aria-label="Centrar en mi ubicación"
                  title="Mi ubicación"
                  class="min-w-[44px] min-h-[44px] rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-sm flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#2a3346] active:bg-slate-100 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors"
                >
                  ${icons.locate('w-5 h-5')}
                </button>

                <button
                  type="button"
                  data-theme-btn
                  aria-label="Cambiar tema claro u oscuro"
                  title="Cambiar tema"
                  class="min-w-[44px] min-h-[44px] rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-sm flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#2a3346] active:bg-slate-100 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors"
                ></button>

                <div data-pwa-slot class="hidden"></div>
              </div>
            </div>

            <!-- 1-Touch Category Segmented Filter + Discreet Status Line -->
            <div class="pointer-events-auto flex flex-col gap-1.5 items-start">
              <div
                role="group"
                aria-label="Filtrar por categoría"
                class="inline-flex items-center gap-1 p-1 rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-sm max-w-full overflow-x-auto native-scroll"
              >
                ${this.renderCategoryButtons()}
              </div>

              <div
                data-status-line
                class="px-3 py-1 rounded-xl bg-white/88 dark:bg-[#242c3c]/88 backdrop-blur-md border border-slate-200/70 dark:border-[#343e52]/80 text-xs font-medium text-slate-700 dark:text-slate-300 font-mono-num shadow-xs"
              >
                Cargando emisoras…
              </div>
            </div>
          </div>

          <!-- Mobile Bottom Sheet + Mini-Player + Fixed Bottom Tab Bar -->
          <div class="lg:hidden fixed inset-x-0 bottom-0 z-30 flex flex-col pointer-events-none">
            <!-- Draggable Sheet -->
            <section
              data-mobile-sheet
              aria-label="Lista de emisoras"
              class="pointer-events-auto flex flex-col rounded-t-3xl border-t border-x border-slate-200/90 dark:border-[#343e52] bg-white/96 dark:bg-[#242c3c]/96 backdrop-blur-md shadow-2xl transition-[height] duration-200 ease-out overflow-hidden"
              style="height: 44dvh;"
            >
              <!-- Touch Drag Handle -->
              <div
                data-sheet-handle
                role="button"
                tabindex="0"
                aria-label="Cambiar altura del panel de emisoras"
                class="w-full py-2.5 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none shrink-0 focus-visible:outline-none"
              >
                <span class="w-11 h-1.5 rounded-full bg-slate-300 dark:bg-[#4b5770]"></span>
              </div>

              <div data-mobile-content class="flex-1 min-h-0 native-scroll px-4 pb-3"></div>
            </section>

            <!-- Mobile Mini-Player (above fixed tab bar) -->
            <div data-mobile-mini-player class="pointer-events-auto hidden px-3 py-2 bg-slate-50/92 dark:bg-[#1e2432]/92 backdrop-blur-md border-t border-slate-200/70 dark:border-[#343e52]"></div>

            <!-- Fixed Mobile 3-Tab Bottom Bar -->
            <nav
              aria-label="Navegación móvil"
              class="pointer-events-auto grid grid-cols-3 border-t border-slate-200/90 dark:border-[#343e52] bg-white/96 dark:bg-[#242c3c]/96 backdrop-blur-md pb-safe"
            >
              ${this.renderTabButtons('mobile')}
            </nav>
          </div>
        </main>

        <!-- Clean Centered Splash Screen (when country is already saved) -->
        <div
          data-splash
          class="hidden fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-slate-50 dark:bg-[#1e2432] p-6"
        >
          ${renderSplashIcon()}
          <div class="w-7 h-7 rounded-full border-[3px] border-slate-200 dark:border-[#343e52] border-t-emerald-700 dark:border-t-[#6ee7b7] animate-spinner" role="status" aria-label="Cargando"></div>
        </div>

        <!-- Country Picker & iOS Guide Modals -->
        <div data-country-modal class="hidden"></div>
        <div data-ios-modal></div>
      </div>
    `;

    this.splashEl = this.root.querySelector('[data-splash]')!;
    this.desktopContentEl = this.root.querySelector('[data-desktop-content]')!;
    this.mobileContentEl = this.root.querySelector('[data-mobile-content]')!;
    this.mobileSheetEl = this.root.querySelector('[data-mobile-sheet]')!;
    this.mobileMiniSlot = this.root.querySelector('[data-mobile-mini-player]')!;
    this.desktopMiniSlot = this.root.querySelector('[data-desktop-mini-player]')!;
    this.countryBtnEl = this.root.querySelector('[data-country-btn]')!;
    this.statusLineEl = this.root.querySelector('[data-status-line]')!;
    this.themeBtnEl = this.root.querySelector('[data-theme-btn]')!;
    this.gpsBtnEl = this.root.querySelector('[data-gps-btn]')!;

    this.updateThemeIcon();
  }

  private renderCategoryButtons(): string {
    const categories: Array<{id: CategoryFilter; label: string}> = [
      {id: 'all', label: 'Todas'},
      {id: 'music', label: 'Música'},
      {id: 'news', label: 'Noticias'},
      {id: 'sports', label: 'Deportes'},
    ];
    return categories
      .map(
        (cat) => `
      <button
        type="button"
        data-category="${cat.id}"
        class="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
          this.activeCategory === cat.id
            ? 'bg-emerald-700 text-white shadow-xs dark:bg-[#6ee7b7] dark:text-[#1e2432]'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a3346] active:bg-slate-200 dark:active:bg-[#343e52]'
        }"
      >
        ${cat.label}
      </button>
    `
      )
      .join('');
  }

  private renderTabButtons(target: 'desktop' | 'mobile'): string {
    const tabs: Array<{id: TabId; label: string; icon: string}> = [
      {id: 'explore', label: 'Explorar', icon: icons.compass('w-5 h-5')},
      {id: 'top', label: 'Top', icon: icons.trending('w-5 h-5')},
      {id: 'favorites', label: 'Favoritas', icon: icons.heart('w-5 h-5', this.activeTab === 'favorites')},
    ];
    return tabs
      .map((t) => {
        const active = this.activeTab === t.id;
        return `
        <button
          type="button"
          data-tab-${target}="${t.id}"
          class="min-h-[54px] py-2 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
            active
              ? 'text-emerald-700 dark:text-[#6ee7b7]'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }"
        >
          ${t.icon}
          <span>${t.label}</span>
        </button>
      `;
      })
      .join('');
  }

  private initSubsystems(): void {
    const mapContainer = this.root.querySelector<HTMLElement>('[data-map-container]')!;
    this.map = new CanvasMap({
      container: mapContainer,
      theme: this.theme,
      paused: !this.selectedCountryCode,
      onSelectStation: (station) => this.handleSelectStation(station, false),
      onInteract: () => {
        if (window.innerWidth < 1024 && this.sheetHeight !== 'min') {
          this.setSheetHeight('min');
        }
      },
    });

    const getMiniContainer = () => (window.innerWidth >= 1024 ? this.desktopMiniSlot : this.mobileMiniSlot);
    // Sync both slots cleanly via a shared wrapper callback
    this.player = new AudioPlayerController(getMiniContainer(), {
      onStatusChange: (status: PlayerStatus, station: Station | null) => {
        this.map.setPlayingStation(
          station && (status === 'playing' || status === 'connecting') ? station.stationuuid : null
        );
        this.syncMiniPlayerSlot();
        this.renderPanels();
      },
      onTryAnotherStation: () => {
        const currentId = this.player.getCurrentStation()?.stationuuid;
        const pool = this.filteredStations.length > 1 ? this.filteredStations : this.allStations;
        const candidate = pool.find((s) => s.stationuuid !== currentId);
        if (candidate) {
          this.handlePlayStation(candidate);
        }
      },
      onSelectStation: (st) => this.handleSelectStation(st, true),
    });

    window.addEventListener('resize', () => this.syncMiniPlayerSlot());

    this.countryPicker = new CountryPickerModal({
      root: this.root.querySelector<HTMLElement>('[data-country-modal]')!,
      onSelectCountry: (country) => this.selectCountry(country),
      onClose: () => {
        this.map.setPaused(false);
      },
    });

    this.pwaInstall = new PWAInstallManager(
      this.root.querySelector<HTMLElement>('[data-pwa-slot]')!,
      this.root.querySelector<HTMLElement>('[data-ios-modal]')!
    );

    this.bindGlobalControls();
    this.bindSheetGestures();
  }

  private syncMiniPlayerSlot(): void {
    const isDesktop = window.innerWidth >= 1024;
    const activeSlot = isDesktop ? this.desktopMiniSlot : this.mobileMiniSlot;
    const inactiveSlot = isDesktop ? this.mobileMiniSlot : this.desktopMiniSlot;

    inactiveSlot.classList.add('hidden');
    inactiveSlot.innerHTML = '';

    // Point player controller to active slot if viewport switched
    (this.player as unknown as {miniRoot: HTMLElement}).miniRoot = activeSlot;
    this.player.renderMiniPlayer();
  }

  private bindGlobalControls(): void {
    this.countryBtnEl.addEventListener('click', () => {
      this.map.setPaused(true);
      this.countryPicker.show(this.selectedCountryCode, Boolean(this.selectedCountryCode));
    });

    this.themeBtnEl.addEventListener('click', () => {
      const next: ThemeMode = this.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(next);
      this.updateThemeIcon();
      this.map.setTheme(next);
      this.player.renderMiniPlayer();
    });

    this.gpsBtnEl.addEventListener('click', () => this.requestGeolocation(true));

    this.root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = (btn.dataset.category as CategoryFilter) || 'all';
        this.activeCategory = cat;
        this.refreshCategoryButtons();
        this.applyFilters();
      });
    });

    this.bindTabListeners();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.countryPicker.isOpen() && this.selectedCountryCode) {
        this.countryPicker.hide();
        this.map.setPaused(false);
      }
    });
  }

  private bindTabListeners(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab-desktop], [data-tab-mobile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = (btn.dataset.tabDesktop || btn.dataset.tabMobile) as TabId;
        this.activeTab = tab;
        this.selectedStation = null;
        this.refreshTabButtons();
        this.renderPanels();
        if (window.innerWidth < 1024 && this.sheetHeight === 'min') {
          this.setSheetHeight('mid');
        }
      });
    });
  }

  private refreshCategoryButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((btn) => {
      const active = btn.dataset.category === this.activeCategory;
      btn.className = `min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
        active
          ? 'bg-emerald-700 text-white shadow-xs dark:bg-[#6ee7b7] dark:text-[#1e2432]'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a3346] active:bg-slate-200 dark:active:bg-[#343e52]'
      }`;
    });
  }

  private refreshTabButtons(): void {
    const desktopNav = this.root.querySelector('aside nav');
    const mobileNav = this.root.querySelector('main nav');
    if (desktopNav) desktopNav.innerHTML = this.renderTabButtons('desktop');
    if (mobileNav) mobileNav.innerHTML = this.renderTabButtons('mobile');
    this.bindTabListeners();
  }

  private updateThemeIcon(): void {
    this.themeBtnEl.innerHTML = this.theme === 'dark' ? icons.sun('w-5 h-5 text-[#fde68a]') : icons.moon('w-5 h-5');
  }

  private bindSheetGestures(): void {
    const handle = this.root.querySelector<HTMLElement>('[data-sheet-handle]')!;
    let startY = 0;
    let startHeight = 0;
    let dragging = false;
    let moved = false;

    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      dragging = true;
      moved = false;
      startY = e.clientY;
      startHeight = this.mobileSheetEl.getBoundingClientRect().height;
      this.mobileSheetEl.style.transition = 'none';
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      const maxH = window.innerHeight * 0.82;
      const minH = 56;
      const nextH = Math.max(minH, Math.min(maxH, startHeight + dy));
      this.mobileSheetEl.style.height = `${nextH}px`;
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      this.mobileSheetEl.style.transition = '';

      if (!moved) {
        // Cycle min -> mid -> full -> min
        const next: SheetHeight =
          this.sheetHeight === 'min' ? 'mid' : this.sheetHeight === 'mid' ? 'full' : 'min';
        this.setSheetHeight(next);
        return;
      }

      const currentH = this.mobileSheetEl.getBoundingClientRect().height;
      const ratio = currentH / window.innerHeight;
      if (ratio < 0.22) this.setSheetHeight('min');
      else if (ratio < 0.62) this.setSheetHeight('mid');
      else this.setSheetHeight('full');
    };

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  private setSheetHeight(height: SheetHeight): void {
    this.sheetHeight = height;
    const mapHeight: Record<SheetHeight, string> = {
      min: '56px',
      mid: '44dvh',
      full: '78dvh',
    };
    this.mobileSheetEl.style.height = mapHeight[height];
  }

  private async bootstrap(): Promise<void> {
    const deepUuid = new URLSearchParams(window.location.search).get('emisora');

    if (this.selectedCountryCode) {
      // Show clean centered splash screen while loading saved country
      this.splashEl.classList.remove('hidden');
      this.updateCountryButton(this.selectedCountryCode);

      const centroid = COUNTRY_CENTROIDS[this.selectedCountryCode];
      if (centroid) {
        this.map.jumpTo(centroid.lat, centroid.lng, centroid.zoom);
      }

      await this.loadStationsForCountry(this.selectedCountryCode);
      this.splashEl.classList.add('hidden');
      this.map.setPaused(false);
    } else {
      // No saved country -> keep map tiles paused and show CountryPicker
      this.map.setPaused(true);
      this.countryPicker.setCountries(this.countries);
      this.countryPicker.show(null, false);
    }

    // Load full countries directory in background
    loadCountriesList().then((list) => {
      this.countries = list;
      this.countryPicker.setCountries(list);
      if (this.selectedCountryCode) {
        this.updateCountryButton(this.selectedCountryCode);
      }
    });

    // Silent background geolocation if permission already granted
    this.checkSilentGeolocation();

    // Deep link ?emisora=UUID
    if (deepUuid) {
      await this.handleDeepLink(deepUuid);
    }
  }

  private async handleDeepLink(uuid: string): Promise<void> {
    let found = this.allStations.find((s) => s.stationuuid === uuid);
    if (!found) {
      found = (await fetchStationByUuid(uuid)) || undefined;
    }
    if (found) {
      if (!this.selectedCountryCode && found.countrycode) {
        this.selectedCountryCode = found.countrycode;
        saveSelectedCountry(found.countrycode);
        this.countryPicker.hide();
        this.map.setPaused(false);
        this.updateCountryButton(found.countrycode);
        await this.loadStationsForCountry(found.countrycode);
      }
      this.handleSelectStation(found, true);
      this.handlePlayStation(found);
    }
  }

  private async checkSilentGeolocation(): Promise<void> {
    if (!('geolocation' in navigator) || !('permissions' in navigator)) return;
    try {
      const perm = await navigator.permissions.query({name: 'geolocation'});
      if (perm.state === 'granted') {
        this.requestGeolocation(false);
      }
    } catch {
      // Ignore unsupported Permissions API
    }
  }

  private requestGeolocation(centerMap: boolean): void {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.userLocation = {lat: pos.coords.latitude, lng: pos.coords.longitude};
        this.map.setUserLocation(this.userLocation);
        if (centerMap) {
          this.map.flyTo(this.userLocation.lat, this.userLocation.lng, 9.5);
        }
        this.renderPanels();
      },
      () => undefined,
      {enableHighAccuracy: false, timeout: 8000, maximumAge: 300000}
    );
  }

  private updateCountryButton(code: string): void {
    const found = this.countries.find((c) => c.code === code);
    const flagEl = this.countryBtnEl.querySelector('[data-country-flag]');
    const labelEl = this.countryBtnEl.querySelector('[data-country-label]');
    if (flagEl) flagEl.textContent = found?.flag || countryCodeToFlag(code);
    if (labelEl) labelEl.textContent = found?.name || COUNTRY_CENTROIDS[code]?.name || code;
  }

  private async selectCountry(country: CountryItem): Promise<void> {
    this.selectedCountryCode = country.code;
    saveSelectedCountry(country.code);
    this.selectedStation = null;
    this.searchQuery = '';
    this.updateCountryButton(country.code);
    this.map.setPaused(false);
    this.map.flyTo(country.lat, country.lng, country.zoom);
    await this.loadStationsForCountry(country.code);
  }

  private async loadStationsForCountry(code: string): Promise<void> {
    this.statusLineEl.textContent = 'Cargando emisoras Online…';
    const result = await loadCountryStationsOnlineFirst(code);

    if (result.source === 'online') {
      this.connectionMode = 'online';
      this.allStations = result.stations;
    } else if (result.source === 'recent-cache') {
      this.connectionMode = 'recent-cache';
      this.allStations = result.stations;
    } else {
      this.connectionMode = 'offline-prompt';
      this.allStations = [];
    }

    this.applyFilters();
  }

  private async handleUseOfflineBackup(): Promise<void> {
    const code = this.selectedCountryCode || 'ES';
    const backup = await loadOfflineBackupStations(code);
    this.connectionMode = 'offline-backup';
    this.allStations = backup;
    this.applyFilters();
  }

  private applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    this.filteredStations = this.allStations.filter((st) => {
      if (this.activeCategory !== 'all' && st.category !== this.activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        st.name.toLowerCase().includes(q) ||
        st.state.toLowerCase().includes(q) ||
        st.tags.toLowerCase().includes(q) ||
        st.language.toLowerCase().includes(q)
      );
    });

    this.map.setStations(this.filteredStations);
    this.updateStatusLine();
    this.renderPanels();
  }

  private updateStatusLine(): void {
    const count = this.filteredStations.length;
    if (this.connectionMode === 'online') {
      this.statusLineEl.textContent = `Online · ${count} emisoras disponibles`;
    } else if (this.connectionMode === 'recent-cache') {
      this.statusLineEl.textContent = `Offline · ${count} emisoras recientes`;
    } else if (this.connectionMode === 'offline-backup') {
      this.statusLineEl.textContent = `Offline · Respaldo local (${count} emisoras)`;
    } else {
      this.statusLineEl.textContent = 'Offline · Sin conexión';
    }
  }

  private handleSelectStation(station: Station, fromList: boolean): void {
    this.selectedStation = station;
    this.copiedFeedback = false;
    this.map.setSelectedStation(station.stationuuid);

    if (station.geo_lat !== null && station.geo_long !== null) {
      this.map.flyTo(station.geo_lat, station.geo_long, fromList ? 10 : undefined);
    }

    if (window.innerWidth < 1024 && this.sheetHeight === 'min') {
      this.setSheetHeight('mid');
    }

    this.renderPanels();
  }

  private handlePlayStation(station: Station): void {
    this.recents = pushRecentStation(station);
    this.player.playStation(station);
  }

  private renderPanels(): void {
    const state: PanelViewState = {
      activeTab: this.activeTab,
      selectedStation: this.selectedStation,
      playingStation: this.player.getCurrentStation(),
      playerStatus: this.player.getStatus(),
      filteredStations: this.filteredStations,
      allCountryStations: this.allStations,
      searchQuery: this.searchQuery,
      sortMode: this.sortMode,
      userLocation: this.userLocation,
      favorites: this.favorites,
      favoriteTagFilter: this.favoriteTagFilter,
      recents: this.recents,
      connectionMode: this.connectionMode,
      copiedFeedback: this.copiedFeedback,
    };

    const actions: PanelActions = {
      onSearchChange: (q) => {
        this.searchQuery = q;
        this.applyFilters();
      },
      onSortModeChange: (mode) => {
        this.sortMode = mode;
        this.renderPanels();
      },
      onSelectStation: (st) => this.handleSelectStation(st, true),
      onPlayStation: (st) => this.handlePlayStation(st),
      onBackFromDetail: () => {
        this.selectedStation = null;
        this.map.setSelectedStation(null);
        this.renderPanels();
      },
      onToggleFavoriteWithTag: (st, tag) => {
        const existing = this.favorites[st.stationuuid];
        if (existing && existing.tag === tag) {
          delete this.favorites[st.stationuuid];
        } else {
          this.favorites[st.stationuuid] = {station: st, tag, savedAt: Date.now()};
        }
        saveFavoritesMap(this.favorites);
        this.renderPanels();
      },
      onSaveCustomTag: (st, tag) => {
        this.favorites[st.stationuuid] = {station: st, tag, savedAt: Date.now()};
        saveFavoritesMap(this.favorites);
        this.renderPanels();
      },
      onRemoveFavorite: (uuid) => {
        delete this.favorites[uuid];
        saveFavoritesMap(this.favorites);
        this.renderPanels();
      },
      onFavoriteTagFilterChange: (tag) => {
        this.favoriteTagFilter = tag;
        this.renderPanels();
      },
      onRetryOnline: () => {
        if (this.selectedCountryCode) {
          this.loadStationsForCountry(this.selectedCountryCode);
        }
      },
      onUseOfflineBackup: () => {
        this.handleUseOfflineBackup();
      },
      onCopyDeepLink: async (st) => {
        const url = `${window.location.origin}${window.location.pathname}?emisora=${encodeURIComponent(st.stationuuid)}`;
        try {
          await navigator.clipboard.writeText(url);
          this.copiedFeedback = true;
          this.renderPanels();
          window.setTimeout(() => {
            this.copiedFeedback = false;
            this.renderPanels();
          }, 2200);
        } catch {
          // Ignore clipboard errors
        }
      },
    };

    renderPanelContent(this.desktopContentEl, state, actions);
    renderPanelContent(this.mobileContentEl, state, actions);
  }
}

const mount = document.getElementById('app');
if (mount) {
  new RadioApp(mount);
}
