import { t } from "../i18n";
export type ClientOs = "macos" | "windows" | "linux";

function detectOs(): ClientOs {
  const agent = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(agent)) return "macos";
  if (/Win/.test(agent)) return "windows";
  return "linux";
}

export const clientOs: ClientOs = detectOs();

/** What the platform calls its file browser, for button labels. */
export const fileManagerName: Record<ClientOs, string> = {
  get macos() {
    return t("common:finder");
  },
  get windows() {
    return t("common:fileExplorer");
  },
  get linux() {
    return t("common:fileManager");
  },
};

/** True for an element where typing should not trigger global shortcuts. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && target.type !== "range")
  );
}
