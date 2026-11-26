const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

export function renderAppLogo(imgClass = 'h-10 w-auto'): string {
  return `
    <div class="inline-flex items-center justify-center rounded-2xl bg-[#FFFDFA] px-2.5 py-1.5 border border-slate-200/80 dark:border-[#343e52] shadow-xs select-none">
      <img
        src="${BASE_URL}logo.png"
        alt="Radio by XivIoT"
        class="${imgClass} object-contain"
        decoding="async"
      />
    </div>
  `;
}

export function renderSplashIcon(): string {
  return `
    <div class="inline-flex items-center justify-center rounded-3xl bg-[#FFFDFA] p-4 border border-slate-200/80 dark:border-[#343e52] shadow-md select-none">
      <img
        src="${BASE_URL}logo.png"
        alt="Radio by XivIoT"
        class="h-24 w-auto object-contain"
        decoding="async"
      />
    </div>
  `;
}
