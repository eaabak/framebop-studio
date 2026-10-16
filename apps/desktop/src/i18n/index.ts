/**
 * Interface translations with i18next. English is bundled; the others load
 * when first chosen. `t` works anywhere (components, stores, helpers): the
 * app root re-renders on a language change, so nothing has to remount.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import {
  type UiLanguage,
  resolveLanguage,
  supportedLanguage,
} from "./languages";
import en from "./locales/en";
import type { LocaleResources, TranslationKey } from "./resources";

export type { TranslationKey } from "./resources";

const LOADERS: Record<
  Exclude<UiLanguage, "en">,
  () => Promise<{ default: LocaleResources }>
> = {
  es: () => import("./locales/es"),
  "pt-BR": () => import("./locales/pt-BR"),
  tr: () => import("./locales/tr"),
  de: () => import("./locales/de"),
};

/** The last language shown, so the next start shows it before the engine answers. */
const CACHE_KEY = "framebop.uiLanguage";

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en },
  ns: Object.keys(en),
  defaultNS: "common",
  nsSeparator: ":",
  keySeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
  showSupportNotice: false,
});

/** The translation of a key, with `{{name}}` values and `count` for plurals. */
export function t(
  key: TranslationKey,
  values?: Record<string, unknown>,
): string {
  return i18n.t(key, values ?? {}) as string;
}

export function currentLanguage(): UiLanguage {
  return supportedLanguage(i18n.language) ?? "en";
}

/** Shows the interface in a language, loading it first if needed. */
export async function setLanguage(language: UiLanguage): Promise<void> {
  if (language !== "en" && !i18n.hasResourceBundle(language, "common")) {
    const { default: resources } = await LOADERS[language]();
    for (const [ns, entries] of Object.entries(resources)) {
      i18n.addResourceBundle(language, ns, entries, true, true);
    }
  }
  await i18n.changeLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
  try {
    localStorage.setItem(CACHE_KEY, language);
  } catch {
    // Storage may be unavailable; the engine's answer still applies.
  }
}

/** The language for the first frame: the last one shown, or a guess. */
export async function startLanguage(): Promise<void> {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    cached = null;
  }
  const language =
    (cached && supportedLanguage(cached)) ||
    resolveLanguage("system", [], navigator.languages ?? [navigator.language]);
  await setLanguage(language).catch(() => setLanguage("en"));
}

/** Applies the user's preference once the engine reports the system's languages. */
export function applyLanguagePreference(
  preference: "system" | UiLanguage,
  systemLanguages: readonly string[],
): Promise<void> {
  return setLanguage(
    resolveLanguage(preference, systemLanguages, navigator.languages ?? []),
  );
}

// ------------------------------------------------------------ formatting

/** A number in the interface language: `1,234.5` or `1.234,5`. */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(currentLanguage(), options).format(value);
}

/** A date and time in the interface language. */
export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  return new Intl.DateTimeFormat(currentLanguage(), options).format(
    new Date(value),
  );
}

/** "3 minutes ago", "yesterday", in the interface language. */
export function formatRelative(
  value: string | number | Date,
  now = Date.now(),
): string {
  const seconds = (new Date(value).getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, size] = units.find(([, s]) => Math.abs(seconds) >= s) ?? [
    "second",
    1,
  ];
  return new Intl.RelativeTimeFormat(currentLanguage(), {
    numeric: "auto",
  }).format(Math.round(seconds / size), unit);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** A file size with the interface language's decimal separator. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 B`;
  const exponent = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : 1;
  return `${formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${BYTE_UNITS[exponent]}`;
}

/** A language's name in the interface language, e.g. for a project's narration. */
export function languageName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([currentLanguage()], { type: "language" }).of(
        code,
      ) ?? code
    );
  } catch {
    return code;
  }
}
