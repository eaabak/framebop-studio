/**
 * The models Framebop Studio offers, from the registry bundled with the app
 * (`registry/framebop-registry.json`, see registry.ts).
 *
 * Every value in the registry was read from the Hugging Face API for the
 * pinned commit on the date in `verifiedOn`: file paths, sizes and hashes,
 * licence and access. Nothing is estimated. Hardware requirements are stated
 * only where the publisher states them; otherwise they are left unknown, and
 * the model is reported as such rather than guessed compatible.
 *
 * To add a model: pin a commit, list only the files that variant needs, copy
 * sizes and hashes from `GET /api/models/{repo}/revision/{commit}?blobs=true`
 * (`lfs.sha256` for LFS files, `blobId` for small ones), read its licence,
 * and record only test runs that really happened.
 */
import { type CatalogEntry, CatalogEntrySchema } from "@framebop/core";
import { BUNDLED_REGISTRY } from "./registry";

export const CATALOG: readonly CatalogEntry[] = BUNDLED_REGISTRY.models;

export function loadCatalog(
  entries: readonly unknown[] = CATALOG,
): CatalogEntry[] {
  const parsed = entries.map((entry, index) => {
    const result = CatalogEntrySchema.safeParse(entry);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(
        `Catalog entry ${index} is invalid: ${issue?.path.join(".")} ${issue?.message}`,
      );
    }
    return result.data;
  });
  const ids = new Set<string>();
  for (const entry of parsed) {
    if (ids.has(entry.id))
      throw new Error(`Catalog id "${entry.id}" is used twice.`);
    ids.add(entry.id);
  }
  return parsed;
}
