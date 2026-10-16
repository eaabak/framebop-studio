/**
 * The operating system's preferred languages, most preferred first, for the
 * interface to choose its language from. A webview's `navigator.languages`
 * does not reliably reflect them (a macOS app without its own localizations
 * reports English), so the engine asks the system itself.
 */
import { runCommand } from "@framebop/ai-adapters";

/** A locale as a BCP 47 tag: `tr_TR.UTF-8` becomes `tr-TR`. */
export function normalizeLocale(value: string): string | null {
  const tag = value.trim().split(/[.@]/)[0]?.replace(/_/g, "-") ?? "";
  if (!tag || tag === "C" || tag === "POSIX") return null;
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : null;
}

/** `defaults read -g AppleLanguages` prints a property list of strings. */
export function parseAppleLanguages(output: string): string[] {
  return [
    ...output.matchAll(/"?([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)"?\s*,?\s*$/gm),
  ]
    .map((match) => normalizeLocale(match[1] ?? ""))
    .filter((tag): tag is string => tag !== null);
}

/** `reg query ... /v Languages` prints a REG_MULTI_SZ joined by `\0`. */
export function parseWindowsLanguages(output: string): string[] {
  const line = output
    .split(/\r?\n/)
    .find((row) => row.includes("REG_MULTI_SZ"));
  const value = line?.split("REG_MULTI_SZ")[1]?.trim() ?? "";
  return value
    .split("\\0")
    .map(normalizeLocale)
    .filter((tag): tag is string => tag !== null);
}

/** POSIX locale variables, in the order programs consult them. */
export function languagesFromEnvironment(env: NodeJS.ProcessEnv): string[] {
  const list = [
    ...(env.LANGUAGE ?? "").split(":"),
    env.LC_ALL ?? "",
    env.LC_MESSAGES ?? "",
    env.LANG ?? "",
  ];
  return list.map(normalizeLocale).filter((tag): tag is string => tag !== null);
}

export async function preferredLanguages(
  os: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  let found: string[] = [];
  if (os === "macos") {
    const result = await runCommand(
      "/usr/bin/defaults",
      ["read", "-g", "AppleLanguages"],
      { timeoutMs: 3000 },
    );
    if (result.ok) found = parseAppleLanguages(result.stdout);
  } else if (os === "windows") {
    const result = await runCommand(
      "reg",
      [
        "query",
        "HKCU\\Control Panel\\International\\User Profile",
        "/v",
        "Languages",
      ],
      { timeoutMs: 3000 },
    );
    if (result.ok) found = parseWindowsLanguages(result.stdout);
  }
  if (found.length === 0) found = languagesFromEnvironment(env);
  if (found.length === 0) {
    const fallback = normalizeLocale(
      Intl.DateTimeFormat().resolvedOptions().locale,
    );
    if (fallback) found = [fallback];
  }
  return [...new Set(found)];
}
