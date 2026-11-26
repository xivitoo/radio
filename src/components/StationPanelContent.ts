import {QUICK_FAVORITE_TAGS} from '../constants';
import type {
  ConnectionMode,
  FavoriteEntry,
  PlayerStatus,
  SortMode,
  Station,
  TabId,
  UserLocation,
} from '../types';
import {distanceKm, escapeHtml, formatCodec, formatTags, sanitizeExternalUrl} from '../utils/geo';
import {icons} from '../utils/icons';
import {renderStationAvatar as renderAvatar} from '../utils/stationAvatar';

export interface PanelViewState {
  activeTab: TabId;
  selectedStation: Station | null;
  playingStation: Station | null;
  playerStatus: PlayerStatus;
  filteredStations: Station[];
  allCountryStations: Station[];
  searchQuery: string;
  sortMode: SortMode;
  userLocation: UserLocation | null;
  favorites: Record<string, FavoriteEntry>;
  favoriteTagFilter: string;
  recents: Station[];
  connectionMode: ConnectionMode;
  copiedFeedback: boolean;
}

export interface PanelActions {
  onSearchChange: (q: string) => void;
  onSortModeChange: (mode: SortMode) => void;
  onSelectStation: (station: Station) => void;
  onPlayStation: (station: Station) => void;
  onBackFromDetail: () => void;
  onToggleFavoriteWithTag: (station: Station, tag: string) => void;
  onSaveCustomTag: (station: Station, tag: string) => void;
  onRemoveFavorite: (uuid: string) => void;
  onFavoriteTagFilterChange: (tag: string) => void;
  onRetryOnline: () => void;
  onUseOfflineBackup: () => void;
  onCopyDeepLink: (station: Station) => void;
}

export function renderStationAvatar(station: Station, sizeClass = 'w-10 h-10', tryFavicon = false): string {
  return renderAvatar(station, sizeClass, tryFavicon);
}

function buildConnectionBanner(mode: ConnectionMode): string {
  if (mode === 'offline-prompt') {
    return `
      <div class="mb-3 rounded-2xl border border-rose-200 dark:border-[#4b333d] bg-rose-50/80 dark:bg-[#2d242d] p-4">
        <div class="text-sm font-semibold text-rose-900 dark:text-[#fda4af]">Sin conexión Online</div>
        <p class="mt-1 text-xs text-rose-700 dark:text-slate-300 leading-relaxed">
          No se pudieron cargar las emisoras Online. Tus favoritas siguen disponibles.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" data-action="retry-online" class="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 dark:bg-[#6ee7b7] dark:text-[#1e2432] dark:hover:bg-[#5cd8a8] dark:active:bg-[#4ac998] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors">
            Reintentar Online
          </button>
          <button type="button" data-action="use-offline-backup" class="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-[#343e52] bg-white dark:bg-[#2a3346] text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#313c52] active:bg-slate-100 dark:active:bg-[#38445c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors">
            Ver respaldo Offline
          </button>
        </div>
      </div>
    `;
  }

  if (mode === 'offline-backup') {
    return `
      <div class="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-amber-200 dark:border-[#4b432c] bg-amber-50/80 dark:bg-[#2d2a24] px-3.5 py-2.5 text-xs">
        <span class="text-amber-900 dark:text-[#fde68a] font-medium">Modo Offline · Respaldo local</span>
        <button type="button" data-action="retry-online" class="px-2.5 py-1.5 rounded-xl font-semibold bg-white dark:bg-[#2a3346] text-slate-800 dark:text-slate-100 border border-amber-200 dark:border-[#343e52] hover:bg-amber-100 dark:hover:bg-[#313c52] focus-visible:outline-none transition-colors shrink-0">
          Reintentar Online
        </button>
      </div>
    `;
  }

  if (mode === 'recent-cache') {
    return `
      <div class="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-sky-200 dark:border-[#34445e] bg-sky-50/80 dark:bg-[#253042] px-3.5 py-2.5 text-xs">
        <span class="text-sky-900 dark:text-[#93c5fd] font-medium">Offline · Últimos datos guardados</span>
        <button type="button" data-action="retry-online" class="px-2.5 py-1.5 rounded-xl font-semibold bg-white dark:bg-[#2a3346] text-slate-800 dark:text-slate-100 border border-sky-200 dark:border-[#343e52] hover:bg-sky-100 dark:hover:bg-[#313c52] focus-visible:outline-none transition-colors shrink-0">
          Reintentar Online
        </button>
      </div>
    `;
  }

  return '';
}

function renderStationRow(
  st: Station,
  state: PanelViewState,
  extraLeftHtml = '',
  distanceText = ''
): string {
  const isPlaying =
    state.playingStation?.stationuuid === st.stationuuid &&
    (state.playerStatus === 'playing' || state.playerStatus === 'connecting');
  const isSelected = state.selectedStation?.stationuuid === st.stationuuid;
  const fav = state.favorites[st.stationuuid];

  const metaParts: string[] = [];
  if (st.state) metaParts.push(st.state);
  else if (st.country) metaParts.push(st.country);
  const tagSlice = formatTags(st.tags, 2).join(', ');
  if (tagSlice) metaParts.push(tagSlice);
  if (st.bitrate > 0) metaParts.push(`${st.bitrate} kbps`);
  if (distanceText) metaParts.push(distanceText);

  return `
    <div class="flex items-center gap-2 py-2.5 border-b border-slate-100 dark:border-[#343e52] last:border-b-0 ${
      isSelected ? 'bg-slate-50/90 dark:bg-[#2a3346]/70 -mx-2 px-2 rounded-2xl' : ''
    }">
      ${extraLeftHtml}
      <button type="button" data-select-station="${st.stationuuid}" class="flex items-center gap-3 min-w-0 flex-1 text-left rounded-xl p-1 -m-1 hover:bg-slate-50 dark:hover:bg-[#2a3346] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors">
        ${renderStationAvatar(st, 'w-10 h-10')}
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">${escapeHtml(st.name)}</span>
            ${fav ? `<span class="text-xs shrink-0" title="${escapeHtml(fav.tag || 'Favorita')}">${fav.tag ? escapeHtml(fav.tag.split(' ')[0]) : '❤️'}</span>` : ''}
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono-num">
            ${escapeHtml(metaParts.join(' · ') || 'Emisora en directo')}
          </div>
        </div>
      </button>

      <button
        type="button"
        data-play-station="${st.stationuuid}"
        aria-label="${isPlaying ? 'Pausar' : 'Reproducir'} ${escapeHtml(st.name)}"
        class="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
          isPlaying
            ? 'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-[#6ee7b7] dark:text-[#1e2432] dark:hover:bg-[#5cd8a8]'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 dark:bg-[#2a3346] dark:text-slate-200 dark:hover:bg-[#313c52] dark:active:bg-[#38445c]'
        }"
      >
        ${isPlaying ? icons.pause('w-4 h-4') : icons.play('w-4 h-4')}
      </button>
    </div>
  `;
}

function renderDetailView(st: Station, state: PanelViewState): string {
  const isPlaying =
    state.playingStation?.stationuuid === st.stationuuid &&
    (state.playerStatus === 'playing' || state.playerStatus === 'connecting');
  const fav = state.favorites[st.stationuuid];
  const currentTag = fav?.tag || '';
  const tagsList = formatTags(st.tags, 6);
  const safeHomepage = sanitizeExternalUrl(st.homepage);
  const shareUrl = `${window.location.origin}${window.location.pathname}?emisora=${encodeURIComponent(st.stationuuid)}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(`Escucha ${st.name} en directo en Radio by XivIoT: ${shareUrl}`)}`;

  return `
    <div class="space-y-4 pb-4">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          data-action="back-detail"
          class="min-h-[44px] px-3 -ml-2 rounded-xl inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a3346] active:bg-slate-200 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors"
        >
          ${icons.arrowLeft('w-4 h-4')}
          <span>Volver</span>
        </button>

        ${
          fav
            ? `<button type="button" data-action="remove-favorite" data-uuid="${st.stationuuid}" class="min-h-[40px] px-3 rounded-xl inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-[#fda4af] bg-rose-50 dark:bg-[#332732] hover:bg-rose-100 dark:hover:bg-[#3f2e3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 transition-colors">
                ${icons.heart('w-4 h-4', true)}
                <span>Quitar de favoritas</span>
              </button>`
            : ''
        }
      </div>

      <div class="flex items-center gap-3.5">
        ${renderStationAvatar(st, 'w-14 h-14', true)}
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug break-words">${escapeHtml(st.name)}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            ${escapeHtml([st.state, st.country].filter(Boolean).join(' · ') || 'Emisión internacional')}
          </p>
        </div>
      </div>

      <button
        type="button"
        data-play-station="${st.stationuuid}"
        class="w-full min-h-[48px] px-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
          isPlaying
            ? 'bg-amber-100 text-amber-950 hover:bg-amber-200 dark:bg-[#fde68a] dark:text-[#1e2432] dark:hover:bg-[#fcd34d]'
            : 'bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 dark:bg-[#6ee7b7] dark:text-[#1e2432] dark:hover:bg-[#5cd8a8] dark:active:bg-[#4ac998]'
        }"
      >
        ${isPlaying ? icons.pause('w-5 h-5') : icons.play('w-5 h-5')}
        <span>${isPlaying ? 'Pausar emisión' : 'Escuchar en directo'}</span>
      </button>

      <!-- Favorite quick tags -->
      <div class="rounded-2xl border border-slate-200/80 dark:border-[#343e52] bg-slate-50/70 dark:bg-[#2a3346]/60 p-3.5 space-y-2.5">
        <div class="text-xs font-semibold text-slate-700 dark:text-slate-200">Guardar en Favoritas con etiqueta</div>
        <div class="flex flex-wrap gap-2">
          ${QUICK_FAVORITE_TAGS.map((tag) => {
            const active = Boolean(fav && currentTag === tag);
            return `
              <button
                type="button"
                data-quick-tag="${escapeHtml(tag)}"
                class="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
                  active
                    ? 'border-emerald-600 bg-emerald-100 text-emerald-950 dark:border-[#6ee7b7] dark:bg-[#2a3a3a] dark:text-[#6ee7b7]'
                    : 'border-slate-200 dark:border-[#343e52] bg-white dark:bg-[#242c3c] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#313c52] active:bg-slate-200 dark:active:bg-[#38445c]'
                }"
              >
                ${escapeHtml(tag)}
              </button>
            `;
          }).join('')}
        </div>

        <form data-custom-tag-form class="flex items-center gap-2 pt-1">
          <input
            type="text"
            name="customTag"
            maxlength="24"
            value="${escapeHtml(QUICK_FAVORITE_TAGS.includes(currentTag as (typeof QUICK_FAVORITE_TAGS)[number]) ? '' : currentTag)}"
            placeholder="Etiqueta personalizada (ej. 🏃 Gym)"
            class="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-[#343e52] bg-white dark:bg-[#1e2432] text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-[#6ee7b7]"
          />
          <button
            type="submit"
            class="min-h-[40px] px-3.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 dark:bg-[#6ee7b7] dark:text-[#1e2432] dark:hover:bg-[#5cd8a8] dark:active:bg-[#4ac998] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors shrink-0"
          >
            Guardar
          </button>
        </form>
      </div>

      <!-- Technical details -->
      <div class="rounded-2xl border border-slate-200/80 dark:border-[#343e52] overflow-hidden">
        <dl class="divide-y divide-slate-100 dark:divide-[#343e52] text-xs">
          <div class="flex items-center justify-between gap-4 px-3.5 py-2.5">
            <dt class="text-slate-500 dark:text-slate-400">Ciudad / Región</dt>
            <dd class="font-medium text-slate-900 dark:text-slate-100 text-right">${escapeHtml(st.state || st.country || 'No especificada')}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 px-3.5 py-2.5">
            <dt class="text-slate-500 dark:text-slate-400">Idioma</dt>
            <dd class="font-medium text-slate-900 dark:text-slate-100 text-right capitalize">${escapeHtml(st.language || 'Multilingüe')}</dd>
          </div>
          <div class="flex items-start justify-between gap-4 px-3.5 py-2.5">
            <dt class="text-slate-500 dark:text-slate-400 shrink-0">Géneros</dt>
            <dd class="font-medium text-slate-900 dark:text-slate-100 text-right">${escapeHtml(tagsList.join(' · ') || 'General')}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 px-3.5 py-2.5">
            <dt class="text-slate-500 dark:text-slate-400">Códec y calidad</dt>
            <dd class="font-mono-num font-medium text-slate-900 dark:text-slate-100 text-right">
              ${escapeHtml(formatCodec(st.codec))}${st.bitrate > 0 ? ` · ${st.bitrate} kbps` : ''}
            </dd>
          </div>
          ${
            safeHomepage
              ? `<div class="flex items-center justify-between gap-4 px-3.5 py-2.5">
                  <dt class="text-slate-500 dark:text-slate-400">Web oficial</dt>
                  <dd class="text-right min-w-0">
                    <a href="${escapeHtml(safeHomepage)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-[#6ee7b7] hover:underline truncate max-w-[200px]">
                      <span>Visitar web</span>
                      ${icons.externalLink('w-3.5 h-3.5 shrink-0')}
                    </a>
                  </dd>
                </div>`
              : ''
          }
        </dl>
      </div>

      <!-- Share buttons -->
      <div class="grid grid-cols-2 gap-2.5">
        <a
          href="${escapeHtml(waHref)}"
          target="_blank"
          rel="noopener noreferrer"
          class="min-h-[44px] px-3 rounded-2xl border border-slate-200 dark:border-[#343e52] bg-white dark:bg-[#2a3346] text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-[#313c52] active:bg-slate-100 dark:active:bg-[#38445c] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors"
        >
          ${icons.share('w-4 h-4 text-emerald-700 dark:text-[#6ee7b7]')}
          <span>WhatsApp</span>
        </a>
        <button
          type="button"
          data-action="copy-link"
          class="min-h-[44px] px-3 rounded-2xl border border-slate-200 dark:border-[#343e52] bg-white dark:bg-[#2a3346] text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-[#313c52] active:bg-slate-100 dark:active:bg-[#38445c] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors"
        >
          ${state.copiedFeedback ? icons.check('w-4 h-4 text-emerald-700 dark:text-[#6ee7b7]') : icons.copy('w-4 h-4 text-sky-700 dark:text-[#93c5fd]')}
          <span>${state.copiedFeedback ? '¡Copiado!' : 'Copiar enlace'}</span>
        </button>
      </div>
    </div>
  `;
}

function renderExploreTab(state: PanelViewState): string {
  const list = [...state.filteredStations];
  if (state.sortMode === 'nearby' && state.userLocation) {
    const loc = state.userLocation;
    list.sort((a, b) => {
      const da =
        a.geo_lat !== null && a.geo_long !== null ? distanceKm(loc.lat, loc.lng, a.geo_lat, a.geo_long) : 999999;
      const db =
        b.geo_lat !== null && b.geo_long !== null ? distanceKm(loc.lat, loc.lng, b.geo_lat, b.geo_long) : 999999;
      return da - db;
    });
  }

  return `
    <div class="space-y-3 pb-4">
      ${buildConnectionBanner(state.connectionMode)}
      <div class="relative">
        <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">${icons.search('w-4 h-4')}</span>
        <input
          type="search"
          data-station-search
          autocomplete="off"
          value="${escapeHtml(state.searchQuery)}"
          placeholder="Buscar emisora, ciudad, idioma o género..."
          class="w-full min-h-[44px] pl-10 pr-4 rounded-2xl border border-slate-200 dark:border-[#343e52] bg-slate-50 dark:bg-[#1e2432] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 hover:border-slate-300 dark:hover:border-[#46536d] focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-[#6ee7b7] focus:bg-white dark:focus:bg-[#2a3346] transition-colors"
        />
      </div>

      ${
        state.userLocation
          ? `<div class="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#1e2432] border border-slate-200/70 dark:border-[#343e52]">
              <button type="button" data-sort="popular" class="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
                state.sortMode === 'popular'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-[#2a3346] dark:text-[#6ee7b7]'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }">Más populares</button>
              <button type="button" data-sort="nearby" class="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
                state.sortMode === 'nearby'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-[#2a3346] dark:text-[#93c5fd]'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }">Más cercanas</button>
            </div>`
          : ''
      }

      <div>
        ${
          list.length === 0
            ? `<div class="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                ${
                  state.searchQuery
                    ? `No hay emisoras que coincidan con «${escapeHtml(state.searchQuery)}».`
                    : 'No hay emisoras disponibles en esta categoría.'
                }
              </div>`
            : list
                .slice(0, 120)
                .map((st) => {
                  let distLabel = '';
                  if (state.sortMode === 'nearby' && state.userLocation && st.geo_lat !== null && st.geo_long !== null) {
                    const km = Math.round(
                      distanceKm(state.userLocation.lat, state.userLocation.lng, st.geo_lat, st.geo_long)
                    );
                    distLabel = `~${km} km`;
                  }
                  return renderStationRow(st, state, '', distLabel);
                })
                .join('')
        }
      </div>
    </div>
  `;
}

function renderTopTab(state: PanelViewState): string {
  const topList = [...state.filteredStations]
    .sort((a, b) => b.clickcount + b.votes * 2 - (a.clickcount + a.votes * 2))
    .slice(0, 50);

  return `
    <div class="space-y-2 pb-4">
      ${buildConnectionBanner(state.connectionMode)}
      <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pb-1">
        <span>Ranking por popularidad y calidad</span>
        <span class="font-mono-num">${topList.length} emisoras</span>
      </div>
      ${
        topList.length === 0
          ? `<div class="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Sin emisoras en el ranking actual.</div>`
          : topList
              .map((st, idx) => {
                const rankHtml = `<span class="w-6 text-center font-mono-num text-xs font-semibold ${
                  idx < 3 ? 'text-emerald-700 dark:text-[#6ee7b7]' : 'text-slate-400 dark:text-slate-500'
                } shrink-0">${String(idx + 1).padStart(2, '0')}</span>`;
                const codecLabel = `${formatCodec(st.codec)}${st.bitrate > 0 ? ` · ${st.bitrate} kbps` : ''}`;
                return renderStationRow(st, state, rankHtml, codecLabel);
              })
              .join('')
      }
    </div>
  `;
}

function renderFavoritesTab(state: PanelViewState): string {
  const entries = Object.values(state.favorites).sort((a, b) => b.savedAt - a.savedAt);
  const availableTags = Array.from(new Set(entries.map((e) => e.tag).filter(Boolean)));

  const filteredEntries =
    state.favoriteTagFilter === 'ALL'
      ? entries
      : entries.filter((e) => e.tag === state.favoriteTagFilter);

  return `
    <div class="space-y-5 pb-4">
      <div>
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">Emisoras favoritas</h3>
          <span class="font-mono-num text-xs text-slate-500 dark:text-slate-400">${entries.length}</span>
        </div>

        ${
          availableTags.length > 0
            ? `<div class="flex flex-wrap gap-1.5 mb-3">
                <button type="button" data-fav-filter="ALL" class="px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors focus-visible:outline-none ${
                  state.favoriteTagFilter === 'ALL'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-[#6ee7b7] dark:bg-[#2a3a3a] dark:text-[#6ee7b7]'
                    : 'border-slate-200 dark:border-[#343e52] bg-white dark:bg-[#2a3346] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#313c52]'
                }">Todas</button>
                ${availableTags
                  .map(
                    (tag) => `
                  <button type="button" data-fav-filter="${escapeHtml(tag)}" class="px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors focus-visible:outline-none ${
                    state.favoriteTagFilter === tag
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-[#6ee7b7] dark:bg-[#2a3a3a] dark:text-[#6ee7b7]'
                      : 'border-slate-200 dark:border-[#343e52] bg-white dark:bg-[#2a3346] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#313c52]'
                  }">${escapeHtml(tag)}</button>
                `
                  )
                  .join('')}
              </div>`
            : ''
        }

        ${
          filteredEntries.length === 0
            ? `<div class="rounded-2xl border border-dashed border-slate-200 dark:border-[#343e52] p-5 text-center text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Todavía no tienes favoritas guardadas${state.favoriteTagFilter !== 'ALL' ? ' en esta etiqueta' : ''}. Pulsa una emisora para guardarla con Casa, Coche o Trabajo.
              </div>`
            : `<div>${filteredEntries.map((e) => renderStationRow(e.station, state, '', e.tag)).join('')}</div>`
        }
      </div>

      ${
        state.recents.length > 0
          ? `<div>
              <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                ${icons.clock('w-3.5 h-3.5')}
                <span>Escuchadas recientemente</span>
              </div>
              <div>
                ${state.recents.slice(0, 10).map((st) => renderStationRow(st, state)).join('')}
              </div>
            </div>`
          : ''
      }
    </div>
  `;
}

export function renderPanelContent(container: HTMLElement, state: PanelViewState, actions: PanelActions): void {
  const prevScroll = container.scrollTop;
  const activeSearch = document.activeElement?.hasAttribute('data-station-search');
  const selStart = activeSearch ? (document.activeElement as HTMLInputElement).selectionStart : null;

  if (state.selectedStation) {
    container.innerHTML = renderDetailView(state.selectedStation, state);
  } else if (state.activeTab === 'explore') {
    container.innerHTML = renderExploreTab(state);
  } else if (state.activeTab === 'top') {
    container.innerHTML = renderTopTab(state);
  } else {
    container.innerHTML = renderFavoritesTab(state);
  }

  container.scrollTop = prevScroll;

  if (activeSearch) {
    const input = container.querySelector<HTMLInputElement>('[data-station-search]');
    if (input) {
      input.focus();
      if (selStart !== null) {
        input.setSelectionRange(selStart, selStart);
      }
    }
  }

  // Bind events
  const stationById = new Map<string, Station>();
  for (const s of state.allCountryStations) stationById.set(s.stationuuid, s);
  for (const s of state.recents) stationById.set(s.stationuuid, s);
  for (const e of Object.values(state.favorites)) stationById.set(e.station.stationuuid, e.station);
  if (state.selectedStation) stationById.set(state.selectedStation.stationuuid, state.selectedStation);

  container.querySelector<HTMLInputElement>('[data-station-search]')?.addEventListener('input', (e) => {
    actions.onSearchChange((e.target as HTMLInputElement).value);
  });

  container.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.sort === 'nearby' ? 'nearby' : 'popular';
      actions.onSortModeChange(mode);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-select-station]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uuid = btn.dataset.selectStation || '';
      const st = stationById.get(uuid);
      if (st) actions.onSelectStation(st);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-play-station]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uuid = btn.dataset.playStation || '';
      const st = stationById.get(uuid);
      if (st) actions.onPlayStation(st);
    });
  });

  container.querySelector('[data-action="back-detail"]')?.addEventListener('click', () => {
    actions.onBackFromDetail();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-quick-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.selectedStation) {
        actions.onToggleFavoriteWithTag(state.selectedStation, btn.dataset.quickTag || '');
      }
    });
  });

  container.querySelector<HTMLFormElement>('[data-custom-tag-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.selectedStation) return;
    const input = (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('input[name="customTag"]');
    const val = (input?.value || '').trim() || '⭐ Favorita';
    actions.onSaveCustomTag(state.selectedStation, val);
  });

  container.querySelector('[data-action="remove-favorite"]')?.addEventListener('click', (e) => {
    const uuid = (e.currentTarget as HTMLElement).dataset.uuid;
    if (uuid) actions.onRemoveFavorite(uuid);
  });

  container.querySelectorAll<HTMLButtonElement>('[data-fav-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onFavoriteTagFilterChange(btn.dataset.favFilter || 'ALL');
    });
  });

  container.querySelector('[data-action="copy-link"]')?.addEventListener('click', () => {
    if (state.selectedStation) actions.onCopyDeepLink(state.selectedStation);
  });

  container.querySelectorAll('[data-action="retry-online"]').forEach((btn) => {
    btn.addEventListener('click', () => actions.onRetryOnline());
  });

  container.querySelectorAll('[data-action="use-offline-backup"]').forEach((btn) => {
    btn.addEventListener('click', () => actions.onUseOfflineBackup());
  });
}
