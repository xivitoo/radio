const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

export function renderAppLogo(imgClass = 'h-10 w-10'): string {
  const sizeClass = imgClass.includes('h-9') ? 'h-10 w-10' : 'h-11 w-11';
  return `
    <div class="inline-flex items-center justify-center rounded-2xl bg-[#1D2939] overflow-hidden border border-slate-200/80 dark:border-[#343e52] shadow-xs select-none">
      <img
        src="${BASE_URL}logo.png"
        alt="Radio by XivIoT"
        class="${sizeClass} object-cover"
        decoding="async"
      />
    </div>
  `;
}

export function renderSplashIcon(): string {
  return `
    <div class="inline-flex items-center justify-center rounded-3xl bg-[#1D2939] overflow-hidden border border-slate-200/80 dark:border-[#343e52] shadow-xl select-none">
      <img
        src="${BASE_URL}logo.png"
        alt="Radio by XivIoT"
        class="h-28 w-28 object-cover"
        decoding="async"
      />
    </div>
  `;
}
