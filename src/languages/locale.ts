export type Locale = "en" | "ru";

const LOCALE_STORAGE_KEY = "liner_locale";

export function getStoredLocale(): Locale {
  if (typeof window === "undefined" || !window.localStorage) return "en";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === "en" || stored === "ru") return stored;
  // Handle legacy stored 'ua'/'uk'
  if (stored === "ua" || stored === "uk") {
    storeLocale("ru");
    return "ru";
  }
  return getBrowserLocale();
}

export function storeLocale(locale: Locale): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}

export function getBrowserLocale(): Locale {
  if (typeof window === "undefined") return "ru";
  const langs = window.navigator.languages ?? [window.navigator.language];
  for (const l of langs) {
    const code = l.slice(0, 2).toLowerCase();
    if (code === "en") return "en";
    if (code === "ru") return "ru";
  }
  return "ru";
}
