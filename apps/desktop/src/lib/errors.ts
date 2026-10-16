import { currentLanguage, t } from "../i18n";
import { EngineError } from "./bridge";

/**
 * What to tell the user about a failed engine call. The engine explains its
 * errors in English; in another interface language the translated summary
 * of what failed comes first and the engine's explanation follows it.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof EngineError)) return fallback;
  if (currentLanguage() === "en") return error.message;
  return `${fallback} ${t("common:engineDetail", { detail: error.message })}`;
}
