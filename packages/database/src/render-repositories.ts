import type { OutputValidation, RenderRecord } from "@framebop/core";
import type { Connection, Row } from "./connection";

/** A render as stored; whether its file is still there is checked on read. */
export type StoredRender = Omit<RenderRecord, "fileStatus">;

function toRender(row: Row): StoredRender {
  return {
    id: row.id as string,
    episodeId: row.episode_id as string,
    jobId: (row.job_id as string | null) ?? null,
    path: row.path as string,
    planHash: row.plan_hash as string,
    width: Number(row.width),
    height: Number(row.height),
    fps: Number(row.fps),
    durationSeconds: Number(row.duration_seconds),
    sizeBytes: Number(row.size_bytes),
    validation: JSON.parse(row.validation_json as string) as OutputValidation,
    createdAt: row.created_at as string,
  };
}

export class RenderRepository {
  constructor(private readonly db: Connection) {}

  insert(render: StoredRender): void {
    this.db.run(
      `INSERT INTO renders (id, episode_id, job_id, path, plan_hash, width, height, fps,
         duration_seconds, size_bytes, validation_json, created_at)
       VALUES (:id, :episodeId, :jobId, :path, :planHash, :width, :height, :fps,
         :durationSeconds, :sizeBytes, :validation, :createdAt)`,
      { ...render, validation: JSON.stringify(render.validation) },
    );
  }

  get(id: string): StoredRender | null {
    const row = this.db.get("SELECT * FROM renders WHERE id = :id", { id });
    return row ? toRender(row) : null;
  }

  /** Newest first. */
  listForEpisode(episodeId: string): StoredRender[] {
    return this.db
      .all(
        "SELECT * FROM renders WHERE episode_id = :episodeId ORDER BY created_at DESC, id",
        { episodeId },
      )
      .map(toRender);
  }

  /** Forgets a render. The file itself is never touched. */
  delete(id: string): boolean {
    return this.db.run("DELETE FROM renders WHERE id = :id", { id }) > 0;
  }
}
