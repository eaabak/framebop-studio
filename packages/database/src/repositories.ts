import type {
  Asset,
  AssetKind,
  Episode,
  EpisodeSummary,
  Job,
  JobStatus,
  Project,
  ProjectSummary,
  Scene,
  SceneSlot,
} from "@framebop/core";
import {
  type Connection,
  type Row,
  type SqlParams,
  type SqlValue,
  buildAssignments,
} from "./connection";

// Row mappers. SQLite hands back loosely typed rows; these are the only places
// that cast, so a schema change surfaces here rather than across the codebase.

const text = (row: Row, column: string): string => row[column] as string;
const optionalText = (row: Row, column: string): string | null =>
  (row[column] as string | null) ?? null;
const numeric = (row: Row, column: string): number => Number(row[column]);
const optionalNumeric = (row: Row, column: string): number | null =>
  row[column] === null || row[column] === undefined
    ? null
    : Number(row[column]);

function toProject(row: Row): Project {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    description: text(row, "description"),
    targetDurationSeconds: numeric(row, "target_duration_seconds"),
    language: text(row, "language"),
    visualStyle: text(row, "visual_style"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function toEpisode(row: Row): Episode {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    sequenceIndex: numeric(row, "sequence_index"),
    title: text(row, "title"),
    script: text(row, "script"),
    productionState: text(
      row,
      "production_state",
    ) as Episode["productionState"],
    musicAssetId: optionalText(row, "music_asset_id"),
    musicVolume: numeric(row, "music_volume"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function toAsset(row: Row): Asset {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    kind: text(row, "kind") as AssetKind,
    origin: text(row, "origin") as Asset["origin"],
    relativePath: text(row, "relative_path"),
    thumbnailPath: optionalText(row, "thumbnail_path"),
    originalFilename: text(row, "original_filename"),
    mimeType: text(row, "mime_type"),
    sizeBytes: numeric(row, "size_bytes"),
    sha256: text(row, "sha256"),
    width: optionalNumeric(row, "width"),
    height: optionalNumeric(row, "height"),
    durationSeconds: optionalNumeric(row, "duration_seconds"),
    createdAt: text(row, "created_at"),
  };
}

function toScene(row: Row): Scene {
  return {
    id: text(row, "id"),
    episodeId: text(row, "episode_id"),
    sequenceIndex: numeric(row, "sequence_index"),
    title: text(row, "title"),
    description: text(row, "description"),
    durationSeconds: numeric(row, "duration_seconds"),
    narrationText: text(row, "narration_text"),
    imagePrompt: text(row, "image_prompt"),
    motionPrompt: text(row, "motion_prompt"),
    cameraMotion: text(row, "camera_motion") as Scene["cameraMotion"],
    cameraInstructions: text(row, "camera_instructions"),
    animationEngine: optionalText(row, "animation_engine"),
    transition: text(row, "transition") as Scene["transition"],
    overlayText: text(row, "overlay_text"),
    overlayPosition: text(row, "overlay_position") as Scene["overlayPosition"],
    imageAssetId: optionalText(row, "image_asset_id"),
    videoAssetId: optionalText(row, "video_asset_id"),
    audioAssetId: optionalText(row, "audio_asset_id"),
    generationState: text(row, "generation_state") as Scene["generationState"],
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toJob(row: Row): Job {
  const errorCode = optionalText(row, "error_code");
  return {
    id: text(row, "id"),
    type: text(row, "type") as Job["type"],
    status: text(row, "status") as JobStatus,
    label: text(row, "label"),
    progress: optionalNumeric(row, "progress"),
    progressMessage: optionalText(row, "progress_message"),
    stage: optionalText(row, "stage") as Job["stage"],
    adapterId: optionalText(row, "adapter_id"),
    model: optionalText(row, "model"),
    projectId: optionalText(row, "project_id"),
    episodeId: optionalText(row, "episode_id"),
    sceneId: optionalText(row, "scene_id"),
    slot: optionalText(row, "slot") as Job["slot"],
    input: parseJsonObject(row.input_json) ?? {},
    output: parseJsonObject(row.output_json),
    outputAssetId: optionalText(row, "output_asset_id"),
    metadata: parseJsonObject(row.metadata_json) ?? {},
    error:
      errorCode === null
        ? null
        : {
            code: errorCode,
            message: optionalText(row, "error_message") ?? "",
          },
    attempt: numeric(row, "attempt"),
    retryOfJobId: optionalText(row, "retry_of_job_id"),
    cancelRequestedAt: optionalText(row, "cancel_requested_at"),
    createdAt: text(row, "created_at"),
    startedAt: optionalText(row, "started_at"),
    finishedAt: optionalText(row, "finished_at"),
    updatedAt: text(row, "updated_at"),
  };
}

/** The asset shown for a scene in lists: its clip if it has one, else its still. */
const COVER_ASSET = "COALESCE(s.video_asset_id, s.image_asset_id)";

const SLOT_COLUMNS: Readonly<Record<SceneSlot, string>> = {
  image: "image_asset_id",
  video: "video_asset_id",
  audio: "audio_asset_id",
};

export class AssetRepository {
  constructor(private readonly db: Connection) {}

  get(id: string): Asset | null {
    const row = this.db.get("SELECT * FROM assets WHERE id = :id", { id });
    return row ? toAsset(row) : null;
  }

  getMany(ids: readonly (string | null)[]): Map<string, Asset> {
    const found = new Map<string, Asset>();
    for (const id of new Set(ids)) {
      if (id === null) continue;
      const asset = this.get(id);
      if (asset) found.set(id, asset);
    }
    return found;
  }

  findByHash(projectId: string, sha256: string): Asset | null {
    const row = this.db.get(
      "SELECT * FROM assets WHERE project_id = :projectId AND sha256 = :sha256 LIMIT 1",
      {
        projectId,
        sha256,
      },
    );
    return row ? toAsset(row) : null;
  }

  listForEpisode(episodeId: string): Asset[] {
    return this.db
      .all(
        `SELECT DISTINCT a.* FROM assets a
         JOIN scenes s ON a.id IN (s.image_asset_id, s.video_asset_id, s.audio_asset_id)
         WHERE s.episode_id = :episodeId
         UNION
         SELECT a.* FROM assets a
         JOIN episodes e ON a.id = e.music_asset_id
         WHERE e.id = :episodeId`,
        { episodeId },
      )
      .map(toAsset);
  }

  /**
   * Assets in a project that nothing points at: no scene, job result,
   * episode music or scene animation.
   */
  listUnreferenced(projectId: string): Asset[] {
    return this.db
      .all(
        `SELECT a.* FROM assets a
         WHERE a.project_id = :projectId
           AND NOT EXISTS (
             SELECT 1 FROM scenes s
             WHERE a.id IN (s.image_asset_id, s.video_asset_id, s.audio_asset_id)
           )
           AND NOT EXISTS (
             SELECT 1 FROM jobs j WHERE j.output_asset_id = a.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM episodes e WHERE e.music_asset_id = a.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM scene_plans p, json_each(p.animation_json, '$.images') i
             WHERE json_extract(i.value, '$.assetId') = a.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM visual_references r, json_each(r.asset_ids_json) i
             WHERE i.value = a.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM scene_plans p, json_each(p.assembly_json, '$.shots') s
             WHERE json_extract(s.value, '$.assetId') = a.id
           )`,
        { projectId },
      )
      .map(toAsset);
  }

  insert(asset: Asset): void {
    this.db.run(
      `INSERT INTO assets (id, project_id, kind, origin, relative_path, thumbnail_path, original_filename,
         mime_type, size_bytes, sha256, width, height, duration_seconds, created_at)
       VALUES (:id, :projectId, :kind, :origin, :relativePath, :thumbnailPath, :originalFilename,
         :mimeType, :sizeBytes, :sha256, :width, :height, :durationSeconds, :createdAt)`,
      { ...asset },
    );
  }

  /** Sets only the metadata columns that are still empty. */
  fillMissingMetadata(
    id: string,
    measured: Pick<Asset, "width" | "height" | "durationSeconds">,
  ): void {
    this.db.run(
      `UPDATE assets
       SET width = COALESCE(width, :width),
           height = COALESCE(height, :height),
           duration_seconds = COALESCE(duration_seconds, :durationSeconds)
       WHERE id = :id`,
      { id, ...measured },
    );
  }

  delete(id: string): boolean {
    return this.db.run("DELETE FROM assets WHERE id = :id", { id }) > 0;
  }
}

export class ProjectRepository {
  constructor(
    private readonly db: Connection,
    private readonly assets: AssetRepository,
  ) {}

  list(): ProjectSummary[] {
    const rows = this.db.all(`
      SELECT p.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.id) AS episode_count,
        (SELECT COUNT(*) FROM scenes s JOIN episodes e ON e.id = s.episode_id
          WHERE e.project_id = p.id) AS scene_count,
        (SELECT COALESCE(SUM(s.duration_seconds), 0) FROM scenes s JOIN episodes e ON e.id = s.episode_id
          WHERE e.project_id = p.id) AS total_duration_seconds,
        (SELECT ${COVER_ASSET} FROM scenes s JOIN episodes e ON e.id = s.episode_id
          WHERE e.project_id = p.id AND ${COVER_ASSET} IS NOT NULL
          ORDER BY e.sequence_index, s.sequence_index LIMIT 1) AS cover_asset_id
      FROM projects p
      ORDER BY p.updated_at DESC, p.name
    `);
    const covers = this.assets.getMany(
      rows.map((row) => optionalText(row, "cover_asset_id")),
    );
    return rows.map((row) => ({
      ...toProject(row),
      episodeCount: numeric(row, "episode_count"),
      sceneCount: numeric(row, "scene_count"),
      totalDurationSeconds: numeric(row, "total_duration_seconds"),
      coverAsset: covers.get(optionalText(row, "cover_asset_id") ?? "") ?? null,
    }));
  }

  get(id: string): Project | null {
    const row = this.db.get("SELECT * FROM projects WHERE id = :id", { id });
    return row ? toProject(row) : null;
  }

  insert(project: Project): void {
    this.db.run(
      `INSERT INTO projects (id, name, description, target_duration_seconds, language, visual_style, created_at, updated_at)
       VALUES (:id, :name, :description, :targetDurationSeconds, :language, :visualStyle, :createdAt, :updatedAt)`,
      { ...project },
    );
  }

  update(id: string, patch: Partial<Project>, updatedAt: string): void {
    const { assignments, params } = buildAssignments(
      {
        name: "name",
        description: "description",
        targetDurationSeconds: "target_duration_seconds",
        language: "language",
        visualStyle: "visual_style",
      },
      patch,
    );
    assignments.push("updated_at = :updated_at");
    this.db.run(
      `UPDATE projects SET ${assignments.join(", ")} WHERE id = :id`,
      {
        ...params,
        updated_at: updatedAt,
        id,
      },
    );
  }

  touch(id: string, updatedAt: string): void {
    this.db.run("UPDATE projects SET updated_at = :updatedAt WHERE id = :id", {
      id,
      updatedAt,
    });
  }

  delete(id: string): boolean {
    return this.db.run("DELETE FROM projects WHERE id = :id", { id }) > 0;
  }
}

export class EpisodeRepository {
  constructor(
    private readonly db: Connection,
    private readonly assets: AssetRepository,
  ) {}

  listSummaries(projectId: string): EpisodeSummary[] {
    const rows = this.db.all(
      `SELECT e.id, e.project_id, e.sequence_index, e.title, e.production_state,
         e.music_asset_id, e.music_volume, e.created_at, e.updated_at,
         (SELECT COUNT(*) FROM scenes s WHERE s.episode_id = e.id) AS scene_count,
         (SELECT COALESCE(SUM(s.duration_seconds), 0) FROM scenes s WHERE s.episode_id = e.id) AS total_duration_seconds,
         (SELECT ${COVER_ASSET} FROM scenes s
           WHERE s.episode_id = e.id AND ${COVER_ASSET} IS NOT NULL
           ORDER BY s.sequence_index LIMIT 1) AS cover_asset_id
       FROM episodes e
       WHERE e.project_id = :projectId
       ORDER BY e.sequence_index, e.created_at`,
      { projectId },
    );
    const covers = this.assets.getMany(
      rows.map((row) => optionalText(row, "cover_asset_id")),
    );
    return rows.map((row) => ({
      id: text(row, "id"),
      projectId: text(row, "project_id"),
      sequenceIndex: numeric(row, "sequence_index"),
      title: text(row, "title"),
      productionState: text(
        row,
        "production_state",
      ) as Episode["productionState"],
      musicAssetId: optionalText(row, "music_asset_id"),
      musicVolume: numeric(row, "music_volume"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
      sceneCount: numeric(row, "scene_count"),
      totalDurationSeconds: numeric(row, "total_duration_seconds"),
      coverAsset: covers.get(optionalText(row, "cover_asset_id") ?? "") ?? null,
    }));
  }

  get(id: string): Episode | null {
    const row = this.db.get("SELECT * FROM episodes WHERE id = :id", { id });
    return row ? toEpisode(row) : null;
  }

  nextSequenceIndex(projectId: string): number {
    const row = this.db.get(
      "SELECT COALESCE(MAX(sequence_index), -1) + 1 AS next FROM episodes WHERE project_id = :projectId",
      { projectId },
    );
    return Number(row?.next ?? 0);
  }

  insert(episode: Episode): void {
    this.db.run(
      `INSERT INTO episodes (id, project_id, sequence_index, title, script, production_state,
         music_asset_id, music_volume, created_at, updated_at)
       VALUES (:id, :projectId, :sequenceIndex, :title, :script, :productionState,
         :musicAssetId, :musicVolume, :createdAt, :updatedAt)`,
      { ...episode },
    );
  }

  update(id: string, patch: Partial<Episode>, updatedAt: string): void {
    const { assignments, params } = buildAssignments(
      {
        title: "title",
        script: "script",
        productionState: "production_state",
        musicAssetId: "music_asset_id",
        musicVolume: "music_volume",
      },
      patch,
    );
    assignments.push("updated_at = :updated_at");
    this.db.run(
      `UPDATE episodes SET ${assignments.join(", ")} WHERE id = :id`,
      {
        ...params,
        updated_at: updatedAt,
        id,
      },
    );
  }

  delete(id: string): boolean {
    return this.db.run("DELETE FROM episodes WHERE id = :id", { id }) > 0;
  }
}

export class SceneRepository {
  constructor(private readonly db: Connection) {}

  listForEpisode(episodeId: string): Scene[] {
    return this.db
      .all(
        "SELECT * FROM scenes WHERE episode_id = :episodeId ORDER BY sequence_index, created_at",
        { episodeId },
      )
      .map(toScene);
  }

  get(id: string): Scene | null {
    const row = this.db.get("SELECT * FROM scenes WHERE id = :id", { id });
    return row ? toScene(row) : null;
  }

  insert(scene: Scene): void {
    this.db.run(
      `INSERT INTO scenes (id, episode_id, sequence_index, title, description, duration_seconds, narration_text,
         image_prompt, motion_prompt, camera_motion, camera_instructions, animation_engine,
         transition, overlay_text, overlay_position,
         image_asset_id, video_asset_id, audio_asset_id, generation_state, created_at, updated_at)
       VALUES (:id, :episodeId, :sequenceIndex, :title, :description, :durationSeconds, :narrationText,
         :imagePrompt, :motionPrompt, :cameraMotion, :cameraInstructions, :animationEngine,
         :transition, :overlayText, :overlayPosition,
         :imageAssetId, :videoAssetId, :audioAssetId, :generationState, :createdAt, :updatedAt)`,
      { ...scene },
    );
  }

  update(id: string, patch: Partial<Scene>, updatedAt: string): void {
    const { assignments, params } = buildAssignments(
      {
        title: "title",
        description: "description",
        durationSeconds: "duration_seconds",
        narrationText: "narration_text",
        imagePrompt: "image_prompt",
        motionPrompt: "motion_prompt",
        cameraMotion: "camera_motion",
        cameraInstructions: "camera_instructions",
        animationEngine: "animation_engine",
        transition: "transition",
        overlayText: "overlay_text",
        overlayPosition: "overlay_position",
      },
      patch,
    );
    assignments.push("updated_at = :updated_at");
    this.db.run(`UPDATE scenes SET ${assignments.join(", ")} WHERE id = :id`, {
      ...params,
      updated_at: updatedAt,
      id,
    });
  }

  setSlot(
    id: string,
    slot: SceneSlot,
    assetId: string | null,
    updatedAt: string,
  ): void {
    // The column name comes from a fixed lookup, never from caller input.
    this.db.run(
      `UPDATE scenes SET ${SLOT_COLUMNS[slot]} = :assetId, updated_at = :updatedAt WHERE id = :id`,
      {
        id,
        assetId,
        updatedAt,
      },
    );
  }

  /** Rewrites sequence indices so they match the order of `orderedIds`. */
  applyOrder(orderedIds: readonly string[]): void {
    orderedIds.forEach((id, index) => {
      this.db.run("UPDATE scenes SET sequence_index = :index WHERE id = :id", {
        id,
        index,
      });
    });
  }

  delete(id: string): boolean {
    return this.db.run("DELETE FROM scenes WHERE id = :id", { id }) > 0;
  }

  deleteForEpisode(episodeId: string): number {
    return this.db.run("DELETE FROM scenes WHERE episode_id = :episodeId", {
      episodeId,
    });
  }
}

/** Fields of a job that change after it has been created. */
export type JobChanges = Partial<
  Pick<
    Job,
    | "status"
    | "progress"
    | "progressMessage"
    | "stage"
    | "output"
    | "outputAssetId"
    | "metadata"
    | "error"
    | "cancelRequestedAt"
    | "startedAt"
    | "finishedAt"
  >
>;

export class JobRepository {
  constructor(private readonly db: Connection) {}

  get(id: string): Job | null {
    const row = this.db.get("SELECT * FROM jobs WHERE id = :id", { id });
    return row ? toJob(row) : null;
  }

  listRecent(limit: number): Job[] {
    return this.db
      .all(
        "SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT :limit",
        {
          limit,
        },
      )
      .map(toJob);
  }

  /** The waiting or running job for a scene slot and kind of work, if any. */
  findActiveForTarget(
    type: Job["type"],
    sceneId: string,
    slot: SceneSlot,
  ): Job | null {
    const row = this.db.get(
      `SELECT * FROM jobs
       WHERE type = :type AND scene_id = :sceneId AND slot = :slot
         AND status IN ('pending', 'running')
       LIMIT 1`,
      { type, sceneId, slot },
    );
    return row ? toJob(row) : null;
  }

  listByStatus(status: JobStatus): Job[] {
    return this.db
      .all(
        "SELECT * FROM jobs WHERE status = :status ORDER BY created_at, rowid",
        { status },
      )
      .map(toJob);
  }

  countByStatus(types: readonly Job["type"][], status: JobStatus): number {
    const row = this.db.get(
      `SELECT COUNT(*) AS total FROM jobs
       WHERE status = :status AND type IN (SELECT value FROM json_each(:types))`,
      { status, types: JSON.stringify(types) },
    );
    return Number(row?.total ?? 0);
  }

  insert(job: Job): void {
    this.db.run(
      `INSERT INTO jobs (id, type, status, label, progress, progress_message, stage, adapter_id, model,
         project_id, episode_id, scene_id, slot, input_json, output_json, output_asset_id,
         metadata_json, error_code, error_message, attempt, retry_of_job_id, cancel_requested_at,
         created_at, started_at, finished_at, updated_at)
       VALUES (:id, :type, :status, :label, :progress, :progressMessage, :stage, :adapterId, :model,
         :projectId, :episodeId, :sceneId, :slot, :inputJson, :outputJson, :outputAssetId,
         :metadataJson, :errorCode, :errorMessage, :attempt, :retryOfJobId, :cancelRequestedAt,
         :createdAt, :startedAt, :finishedAt, :updatedAt)`,
      {
        id: job.id,
        type: job.type,
        status: job.status,
        label: job.label,
        progress: job.progress,
        progressMessage: job.progressMessage,
        stage: job.stage,
        adapterId: job.adapterId,
        model: job.model,
        projectId: job.projectId,
        episodeId: job.episodeId,
        sceneId: job.sceneId,
        slot: job.slot,
        inputJson: JSON.stringify(job.input),
        outputJson: job.output === null ? null : JSON.stringify(job.output),
        outputAssetId: job.outputAssetId,
        metadataJson: JSON.stringify(job.metadata),
        errorCode: job.error?.code ?? null,
        errorMessage: job.error?.message ?? null,
        attempt: job.attempt,
        retryOfJobId: job.retryOfJobId,
        cancelRequestedAt: job.cancelRequestedAt,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        updatedAt: job.updatedAt,
      },
    );
  }

  update(id: string, changes: JobChanges, updatedAt: string): void {
    const assignments = ["updated_at = :updated_at"];
    const params: SqlParams = { id, updated_at: updatedAt };
    const set = (column: string, value: SqlValue) => {
      assignments.push(`${column} = :${column}`);
      params[column] = value;
    };
    if (changes.status !== undefined) set("status", changes.status);
    if (changes.progress !== undefined) set("progress", changes.progress);
    if (changes.progressMessage !== undefined) {
      set("progress_message", changes.progressMessage);
    }
    if (changes.stage !== undefined) set("stage", changes.stage);
    if (changes.output !== undefined) {
      set(
        "output_json",
        changes.output === null ? null : JSON.stringify(changes.output),
      );
    }
    if (changes.outputAssetId !== undefined) {
      set("output_asset_id", changes.outputAssetId);
    }
    if (changes.metadata !== undefined) {
      set("metadata_json", JSON.stringify(changes.metadata));
    }
    if (changes.error !== undefined) {
      set("error_code", changes.error?.code ?? null);
      set("error_message", changes.error?.message ?? null);
    }
    if (changes.cancelRequestedAt !== undefined) {
      set("cancel_requested_at", changes.cancelRequestedAt);
    }
    if (changes.startedAt !== undefined) set("started_at", changes.startedAt);
    if (changes.finishedAt !== undefined)
      set("finished_at", changes.finishedAt);
    this.db.run(
      `UPDATE jobs SET ${assignments.join(", ")} WHERE id = :id`,
      params,
    );
  }

  /**
   * Takes the oldest waiting job of the given kinds and marks it running, in
   * one transaction, so the same job can never be started twice.
   */
  claimNextPending(
    types: readonly Job["type"][],
    startedAt: string,
  ): Job | null {
    return this.db.transaction(() => {
      const row = this.db.get(
        `SELECT id FROM jobs
         WHERE status = 'pending' AND type IN (SELECT value FROM json_each(:types))
         ORDER BY created_at, rowid
         LIMIT 1`,
        { types: JSON.stringify(types) },
      );
      if (!row) return null;
      const id = text(row, "id");
      const claimed = this.db.run(
        `UPDATE jobs
         SET status = 'running', started_at = :startedAt, updated_at = :startedAt,
             progress = NULL, progress_message = NULL, stage = NULL
         WHERE id = :id AND status = 'pending'`,
        { id, startedAt },
      );
      return claimed === 1 ? this.get(id) : null;
    });
  }

  /**
   * Marks jobs that a previous process left running as interrupted. Their
   * work is gone, and whether to run them again is the user's decision, so
   * they are never put back in the queue.
   */
  markRunningAsInterrupted(at: string): number {
    return this.db.run(
      `UPDATE jobs
       SET status = 'interrupted', progress = NULL, progress_message = NULL,
           finished_at = :at, updated_at = :at, error_code = 'INTERRUPTED',
           error_message = 'The application closed while this job was running.'
       WHERE status = 'running'`,
      { at },
    );
  }

  deleteFinished(): number {
    return this.db.run(
      "DELETE FROM jobs WHERE status NOT IN ('pending', 'running')",
    );
  }
}

export class SettingsRepository {
  constructor(private readonly db: Connection) {}

  getAll(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const row of this.db.all("SELECT key, value_json FROM settings")) {
      try {
        values[text(row, "key")] = JSON.parse(text(row, "value_json"));
      } catch {
        // A corrupt value falls back to its default instead of blocking startup.
      }
    }
    return values;
  }

  set(key: string, value: unknown, updatedAt: string): void {
    this.db.run(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (:key, :valueJson, :updatedAt)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      { key, valueJson: JSON.stringify(value), updatedAt },
    );
  }
}
