/**
 * The Framebop model registry.
 *
 * The registry is a versioned JSON manifest (see `RegistryManifestSchema`):
 * every model the maintainers have reviewed, pinned to an exact commit, with
 * its files and hashes, licence, runtime, hardware notes, presets and the
 * runs that were actually tested. A copy ships with the app in
 * `registry/framebop-registry.json`. A newer copy can be fetched from a URL,
 * but only when the user asks; nothing is fetched at startup.
 *
 * This keeps new variants of models that existing engines already run out
 * of the release cycle: they need a registry update, not an app update. A
 * model that needs a new engine still needs a new version of the app.
 */
import {
  AppError,
  type RegistryManifest,
  RegistryManifestSchema,
  REGISTRY_SCHEMA_VERSION,
} from "@framebop/core";
import bundled from "../registry/framebop-registry.json" with { type: "json" };

/** Large enough for thousands of entries; small enough to never be abused. */
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/** Validates registry data. Throws an error naming the first problem. */
export function parseRegistry(data: unknown): RegistryManifest {
  if (
    typeof data === "object" &&
    data !== null &&
    "schemaVersion" in data &&
    data.schemaVersion !== REGISTRY_SCHEMA_VERSION
  ) {
    throw new AppError(
      "UNSUPPORTED",
      `This registry uses format ${String(data.schemaVersion)}; this version of Framebop Studio reads format ${REGISTRY_SCHEMA_VERSION}. Update the app to use it.`,
    );
  }
  const result = RegistryManifestSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(
      "VALIDATION",
      `The registry is not valid: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
    );
  }
  return result.data;
}

export const BUNDLED_REGISTRY: RegistryManifest = parseRegistry(bundled);

/**
 * Only https, except on this computer's loopback interface, which lets a
 * maintainer test a registry locally. Credentials in URLs are refused.
 */
export function checkRegistryUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("VALIDATION", "The registry address is not a URL.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    parsed.hostname,
  );
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    throw new AppError("VALIDATION", "The registry must be served over https.");
  }
  if (parsed.username || parsed.password) {
    throw new AppError(
      "VALIDATION",
      "The registry address must not contain a user name or password.",
    );
  }
  return parsed;
}

/** Fetches and validates a registry. Nothing is kept if anything is wrong. */
export async function fetchRegistry(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistryManifest> {
  checkRegistryUrl(url);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: abort.signal,
        headers: { accept: "application/json" },
        redirect: "follow",
      });
    } catch (error) {
      throw new AppError(
        "UNAVAILABLE",
        abort.signal.aborted
          ? "The registry did not answer in time."
          : `The registry could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // A redirect must not lead somewhere less safe than the original.
    if (response.url) checkRegistryUrl(response.url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "UNAVAILABLE",
        `The registry answered with status ${response.status}.`,
      );
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_REGISTRY_BYTES) {
      await response.body?.cancel();
      throw new AppError("VALIDATION", "The registry file is too large.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_REGISTRY_BYTES) {
        throw new AppError("VALIDATION", "The registry file is too large.");
      }
      chunks.push(chunk);
    }
    let data: unknown;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AppError("VALIDATION", "The registry is not valid JSON.");
    }
    return parseRegistry(data);
  } finally {
    clearTimeout(timer);
  }
}

/** Registry versions are dates, so later ones sort later as text. */
export function isNewerRegistry(
  candidate: RegistryManifest,
  current: RegistryManifest,
): boolean {
  const pad = (version: string) =>
    version
      .split(".")
      .map((part) => part.padStart(4, "0"))
      .join(".");
  return pad(candidate.registryVersion) > pad(current.registryVersion);
}
