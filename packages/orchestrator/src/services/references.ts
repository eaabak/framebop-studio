/**
 * Visual references: characters, places and styles that several scenes of a
 * project share. A generation for a linked scene carries their words in its
 * prompt, and their approved pictures are offered as its starting image.
 */
import {
  AppError,
  type RpcParsedParams,
  type VisualReference,
} from "@framebop/core";
import type { EngineContext } from "../context";
import { requireProject } from "./shared";
import { importReferencePicture } from "./assets";

export class VisualReferenceService {
  constructor(private readonly ctx: EngineContext) {}

  list(projectId: string): VisualReference[] {
    requireProject(this.ctx, projectId);
    return this.ctx.db.visualReferences.list(projectId);
  }

  save(input: RpcParsedParams<"visualReferences.save">): VisualReference {
    const { db } = this.ctx;
    requireProject(this.ctx, input.projectId);
    const existing = input.id ? db.visualReferences.get(input.id) : null;
    if (input.id && existing?.projectId !== input.projectId) {
      throw new AppError("NOT_FOUND", "That reference no longer exists.");
    }
    // Only pictures of this project: a reference never reaches into another
    // project's media, or into files outside the library.
    for (const assetId of input.assetIds) {
      const asset = db.assets.get(assetId);
      if (asset?.projectId !== input.projectId || asset.kind !== "image") {
        throw new AppError(
          "VALIDATION",
          "A reference can only use pictures from this project's library.",
        );
      }
    }
    const now = this.ctx.now();
    const reference: VisualReference = {
      id: existing?.id ?? this.ctx.newId(),
      projectId: input.projectId,
      kind: input.kind,
      name: input.name,
      description: input.description,
      palette: input.palette,
      assetIds: [...new Set(input.assetIds)],
      seed: input.seed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    db.visualReferences.put(reference);
    return reference;
  }

  async importImage(referenceId: string, sourcePath: string) {
    const reference = this.ctx.db.visualReferences.get(referenceId);
    if (!reference)
      throw new AppError("NOT_FOUND", "That reference no longer exists.");
    if (reference.assetIds.length >= 8)
      throw new AppError(
        "VALIDATION",
        "A reference can hold up to eight pictures.",
      );
    const asset = await importReferencePicture(
      this.ctx,
      reference.projectId,
      sourcePath,
    );
    const current = this.ctx.db.visualReferences.get(referenceId);
    if (!current)
      throw new AppError(
        "NOT_FOUND",
        "That reference was removed while importing.",
      );
    const saved = this.save({
      ...current,
      assetIds: [...new Set([...current.assetIds, asset.id])].slice(0, 8),
    });
    return { reference: saved, asset };
  }

  /**
   * Removes the reference and unlinks it from every scene. Pictures that
   * nothing else uses go with the library's next cleanup, like any others.
   */
  delete(id: string): void {
    const { db } = this.ctx;
    const reference = db.visualReferences.get(id);
    if (!reference) {
      throw new AppError("NOT_FOUND", "That reference no longer exists.");
    }
    const now = this.ctx.now();
    db.transaction(() => {
      for (const episode of db.episodes.listSummaries(reference.projectId)) {
        for (const plan of db.plans.forEpisode(episode.id).values()) {
          if (!plan.visualReferenceIds.includes(id)) continue;
          db.plans.put({
            ...plan,
            visualReferenceIds: plan.visualReferenceIds.filter(
              (other) => other !== id,
            ),
            updatedAt: now,
          });
        }
      }
      db.visualReferences.delete(id);
    });
  }

  /** The references of a project with the given ids, in that order. */
  resolve(projectId: string, ids: readonly string[]): VisualReference[] {
    return ids.map((id) => {
      const reference = this.ctx.db.visualReferences.get(id);
      if (reference?.projectId !== projectId) {
        throw new AppError(
          "VALIDATION",
          "A chosen reference is not part of this project.",
        );
      }
      return reference;
    });
  }
}
