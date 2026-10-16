import type en from "./locales/en";

/** The English resources: every namespace and key the interface uses. */
export type Resources = typeof en;

/**
 * A translation: every English key with a string of its own. Extra keys
 * are allowed for plural forms English does not have (Spanish "many").
 */
export type LocaleResources = {
  [NS in keyof Resources]: { [K in keyof Resources[NS]]: string } & Record<
    string,
    string
  >;
};

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type Base<K> = K extends `${infer B}_${PluralSuffix}` ? B : K;

/** `namespace:key`, with plural keys named without their suffix. */
export type TranslationKey = {
  [
    NS in keyof Resources & string
  ]: `${NS}:${Base<keyof Resources[NS] & string>}`;
}[keyof Resources & string];
