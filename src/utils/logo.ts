const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';

export function renderAppLogo(imgClass = 'h-10 w-auto'): string {
  const heightClass = imgClass.includes('h-9') ? 'h-10 w-auto' : 'h-12 w-auto';
  return `
    <div class="inline-flex items-center justify-center rounded-2xl bg-black px-2.5 py-1.5 border border-slate-200/80 dark:border-[#343e52] shadow-xs select-none">
      <img
        src="${BASE_URL}logo.png"
        alt="Radio by XivIoT"
        class="${heightClass} object-contain"
        decoding="async"
      />
    </div>
  `;
}

export function renderSplashIcon(): string {
  return `
    <div class="inline-flex items-center justify-center rounded-3xl bg-black p-4 border border-slate-200/80 dark:border-[#343e52] shadow-xl select-none">
      <img
        src="${BASE_URL}logo.png"
        alt="Radio by XivIoT"
        class="h-28 sm:h-32 w-auto object-contain"
        decoding="async"
      />
    </div>
  `;
}
