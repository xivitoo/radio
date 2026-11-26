import type {CountryItem} from '../types';
import {escapeHtml} from '../utils/geo';
import {icons} from '../utils/icons';
import {renderAppLogo} from '../utils/logo';

export interface CountryPickerOptions {
  root: HTMLElement;
  onSelectCountry: (country: CountryItem) => void;
  onClose?: () => void;
}

export class CountryPickerModal {
  private root: HTMLElement;
  private countries: CountryItem[] = [];
  private selectedCode: string | null = null;
  private query = '';
  private open = false;
  private allowDismiss = false;
  private onSelectCountry: (country: CountryItem) => void;
  private onClose?: () => void;

  constructor(options: CountryPickerOptions) {
    this.root = options.root;
    this.onSelectCountry = options.onSelectCountry;
    this.onClose = options.onClose;
  }

  public setCountries(countries: CountryItem[]): void {
    this.countries = countries;
    if (this.open) this.renderListOnly();
  }

  public show(selectedCode: string | null, allowDismiss: boolean): void {
    this.selectedCode = selectedCode;
    this.allowDismiss = allowDismiss;
    this.open = true;
    this.query = '';
    this.render();
    window.setTimeout(() => {
      const input = this.root.querySelector<HTMLInputElement>('[data-country-search]');
      input?.focus();
    }, 50);
  }

  public hide(): void {
    this.open = false;
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }

  public isOpen(): boolean {
    return this.open;
  }

  private getFiltered(): {featured: CountryItem[]; others: CountryItem[]} {
    const q = this.query.trim().toLowerCase();
    const matches = this.countries.filter((c) => {
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
    });
    return {
      featured: matches.filter((c) => c.featured),
      others: matches.filter((c) => !c.featured),
    };
  }

  private render(): void {
    this.root.classList.remove('hidden');
    this.root.innerHTML = `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 dark:bg-[#141923]/80 backdrop-blur-sm p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Seleccionar país">
        <div class="w-full max-w-xl max-h-[88dvh] flex flex-col rounded-3xl border border-slate-200/80 dark:border-[#343e52] bg-white dark:bg-[#242c3c] shadow-2xl overflow-hidden">
          <!-- Header: ONLY the app logo -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-[#343e52] shrink-0">
            <div>${renderAppLogo('h-9 w-auto')}</div>
            ${
              this.allowDismiss
                ? `<button type="button" data-action="close-modal" aria-label="Cerrar selector de país" class="min-w-[44px] min-h-[44px] rounded-2xl flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#2a3346] hover:bg-slate-100 dark:hover:bg-[#343e52] active:bg-slate-200 dark:active:bg-[#3d485f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors">
                    ${icons.x('w-5 h-5')}
                  </button>`
                : ''
            }
          </div>

          <!-- Instant search -->
          <div class="p-4 sm:px-5 border-b border-slate-100 dark:border-[#343e52] shrink-0">
            <label for="country-search-input" class="block text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">
              Elige un país para explorar sus emisoras
            </label>
            <div class="relative">
              <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400">
                ${icons.search('w-4 h-4')}
              </span>
              <input
                id="country-search-input"
                type="search"
                data-country-search
                autocomplete="off"
                placeholder="Buscar país (España, México, Argentina...)"
                value="${escapeHtml(this.query)}"
                class="w-full min-h-[44px] pl-10 pr-4 rounded-2xl border border-slate-200 dark:border-[#343e52] bg-slate-50 dark:bg-[#1e2432] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 hover:border-slate-300 dark:hover:border-[#46536d] focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-[#6ee7b7] focus:bg-white dark:focus:bg-[#2a3346] transition-colors"
              />
            </div>
          </div>

          <!-- Country results -->
          <div data-country-list class="flex-1 min-h-0 native-scroll p-4 sm:p-5 space-y-5"></div>
        </div>
      </div>
    `;

    this.root.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });

    const input = this.root.querySelector<HTMLInputElement>('[data-country-search]');
    input?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value;
      this.renderListOnly();
    });

    this.renderListOnly();
  }

  private renderListOnly(): void {
    const listEl = this.root.querySelector('[data-country-list]');
    if (!listEl) return;

    const {featured, others} = this.getFiltered();
    if (featured.length === 0 && others.length === 0) {
      listEl.innerHTML = `
        <div class="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          No encontramos ningún país con «${escapeHtml(this.query)}».
        </div>
      `;
      return;
    }

    const renderButton = (c: CountryItem) => {
      const active = c.code === this.selectedCode;
      return `
        <button
          type="button"
          data-country-code="${c.code}"
          class="min-h-[52px] w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-2xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] ${
            active
              ? 'border-emerald-600 bg-emerald-50 text-emerald-950 dark:border-[#6ee7b7] dark:bg-[#2a3a3a] dark:text-[#6ee7b7]'
              : 'border-slate-200/80 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100 dark:border-[#343e52] dark:bg-[#2a3346] dark:text-slate-100 dark:hover:bg-[#313c52] dark:active:bg-[#38445c]'
          }"
        >
          <span class="flex items-center gap-2.5 min-w-0">
            <span class="text-xl leading-none shrink-0" aria-hidden="true">${c.flag}</span>
            <span class="text-sm font-semibold truncate">${escapeHtml(c.name)}</span>
          </span>
          <span class="font-mono-num text-xs text-slate-500 dark:text-slate-300 shrink-0">${c.stationCount}</span>
        </button>
      `;
    };

    listEl.innerHTML = `
      ${
        featured.length > 0
          ? `<div>
              <h3 class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">Destacados</h3>
              <div class="grid grid-cols-2 gap-2.5">
                ${featured.map(renderButton).join('')}
              </div>
            </div>`
          : ''
      }
      ${
        others.length > 0
          ? `<div>
              <h3 class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">Más países</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${others.map(renderButton).join('')}
              </div>
            </div>`
          : ''
      }
    `;

    listEl.querySelectorAll<HTMLButtonElement>('[data-country-code]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.countryCode;
        const found = this.countries.find((c) => c.code === code);
        if (found) {
          this.hide();
          this.onSelectCountry(found);
        }
      });
    });
  }
}
