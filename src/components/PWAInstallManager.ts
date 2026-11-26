import {icons} from '../utils/icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

export class PWAInstallManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private isInstalled = false;
  private isIOS = false;
  private buttonSlot: HTMLElement;
  private modalRoot: HTMLElement;
  private showIOSGuide = false;

  constructor(buttonSlot: HTMLElement, modalRoot: HTMLElement) {
    this.buttonSlot = buttonSlot;
    this.modalRoot = modalRoot;

    this.isInstalled =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as {standalone?: boolean}).standalone === true;

    const ua = window.navigator.userAgent.toLowerCase();
    this.isIOS = /iphone|ipad|ipod/.test(ua);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.renderButton();
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.deferredPrompt = null;
      this.renderButton();
    });

    this.renderButton();
  }

  public renderButton(): void {
    if (this.isInstalled || (!this.deferredPrompt && !this.isIOS)) {
      this.buttonSlot.innerHTML = '';
      this.buttonSlot.classList.add('hidden');
      return;
    }

    this.buttonSlot.classList.remove('hidden');
    this.buttonSlot.innerHTML = `
      <button
        type="button"
        data-action="pwa-install"
        aria-label="Instalar aplicación"
        title="${this.isIOS ? 'Instalar en iOS' : 'Instalar app'}"
        class="min-h-[44px] px-3 rounded-2xl border border-slate-200/90 dark:border-[#343e52] bg-white/95 dark:bg-[#242c3c]/95 backdrop-blur-md shadow-sm flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-[#6ee7b7] hover:bg-slate-50 dark:hover:bg-[#2a3346] active:bg-slate-100 dark:active:bg-[#343e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7] transition-colors whitespace-nowrap shrink-0"
      >
        ${icons.download('w-4 h-4')}
        <span class="hidden sm:inline">Instalar</span>
      </button>
    `;

    this.buttonSlot.querySelector('[data-action="pwa-install"]')?.addEventListener('click', () => {
      if (this.deferredPrompt) {
        this.promptInstall();
      } else if (this.isIOS) {
        this.showIOSGuide = true;
        this.renderIOSModal();
      }
    });
  }

  private async promptInstall(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    const {outcome} = await this.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      this.isInstalled = true;
      this.deferredPrompt = null;
      this.renderButton();
    }
  }

  private renderIOSModal(): void {
    if (!this.showIOSGuide) {
      this.modalRoot.innerHTML = '';
      return;
    }

    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/65 backdrop-blur-xs p-4" role="dialog" aria-modal="true" aria-labelledby="ios-install-title">
        <div class="w-full max-w-sm rounded-3xl border border-slate-200/80 dark:border-[#343e52] bg-white dark:bg-[#242c3c] p-6 shadow-2xl">
          <div class="flex items-start justify-between gap-3">
            <h2 id="ios-install-title" class="text-lg font-bold text-slate-900 dark:text-slate-100">Instalar en iPhone o iPad</h2>
            <button type="button" data-action="close-ios" aria-label="Cerrar" class="min-w-[40px] min-h-[40px] -mr-2 -mt-2 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2a3346] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7]">
              ${icons.x('w-5 h-5')}
            </button>
          </div>
          <ol class="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <li class="flex gap-2.5">
              <span class="font-mono-num font-semibold text-emerald-700 dark:text-[#6ee7b7]">1.</span>
              <span>Pulsa el botón <strong>Compartir</strong> en la barra inferior o superior de Safari.</span>
            </li>
            <li class="flex gap-2.5">
              <span class="font-mono-num font-semibold text-emerald-700 dark:text-[#6ee7b7]">2.</span>
              <span>Desliza hacia abajo y selecciona <strong>Añadir a pantalla de inicio</strong>.</span>
            </li>
          </ol>
          <button type="button" data-action="close-ios" class="mt-5 w-full min-h-[44px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white dark:bg-[#6ee7b7] dark:hover:bg-[#5cd8a8] dark:active:bg-[#4ac998] dark:text-[#1e2432] text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-[#6ee7b7]">
            Entendido
          </button>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll('[data-action="close-ios"]').forEach((el) => {
      el.addEventListener('click', () => {
        this.showIOSGuide = false;
        this.renderIOSModal();
      });
    });
  }
}
