/**
 * The interface languages and how one is chosen from the operating
 * system's preferences. Independent of any project's content language.
 */
import { UI_LANGUAGES, type UiLanguage } from "@framebop/core";

export { UI_LANGUAGES, type UiLanguage };

/** Each language's name in itself, as shown in Settings. */
export const NATIVE_NAMES: Record<UiLanguage, string> = {
  en: "English",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  tr: "Türkçe",
  de: "Deutsch",
};

/**
 * The supported language for a locale, by language and then by base
 * language: `tr-TR` is Turkish, `es-MX` Spanish, and any Portuguese is
 * Brazilian Portuguese until European Portuguese is translated.
 */
export function supportedLanguage(locale: string): UiLanguage | null {
  const tag = locale.trim().replace(/_/g, "-").toLowerCase();
  if (!tag) return null;
  const exact = UI_LANGUAGES.find((language) => language.toLowerCase() === tag);
  if (exact) return exact;
  const base = tag.split("-")[0];
  if (base === "pt") return "pt-BR";
  return UI_LANGUAGES.find((language) => language === base) ?? null;
}

/** The first of the preferred locales that is supported, else English. */
export function matchLanguage(preferred: readonly string[]): UiLanguage {
  for (const locale of preferred) {
    const match = supportedLanguage(locale);
    if (match) return match;
  }
  return "en";
}

/**
 * The language to show: the user's explicit choice, or the system's
 * preferences in order (the engine's view of them first, since a webview's
 * own list may not follow the system), or English.
 */
export function resolveLanguage(
  preference: "system" | UiLanguage,
  systemLanguages: readonly string[],
  browserLanguages: readonly string[] = [],
): UiLanguage {
  if (preference !== "system") return preference;
  return matchLanguage(
    systemLanguages.length > 0 ? systemLanguages : browserLanguages,
  );
}
