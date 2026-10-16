import {
  type DoctorExport,
  type Inspection,
  InspectionIssuesSchema,
  InspectionOverviewSchema,
  InspectionScenesSchema,
  InspectionSourceSchema,
  DoctorThresholdsSchema,
} from "@framebop/core";
import type { Connection, Row } from "./connection";

/** JSON that no longer validates is replaced by `fallback`, not trusted. */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function parsed<T>(schema: Parser<T>, json: unknown, fallback: T): T {
  if (typeof json !== "string") return fallback;
  try {
    const result = schema.safeParse(JSON.parse(json));
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

function toInspection(row: Row): Inspection | null {
  const source = parsed(
    InspectionSourceSchema.nullable(),
    row.source_json,
    null,
  );
  if (source === null) return null;
  return {
    id: row.id as string,
    jobId: (row.job_id as string | null) ?? null,
    name: row.name as string,
    source,
    thresholds: parsed(
      DoctorThresholdsSchema,
      row.thresholds_json,
      DoctorThresholdsSchema.parse({}),
    ),
    status: row.status as Inspection["status"],
    error: (row.error as string | null) ?? null,
    overview: parsed(
      InspectionOverviewSchema.nullable(),
      row.overview_json,
      null,
    ),
    scenes: parsed(InspectionScenesSchema, row.scenes_json, []),
    issues: parsed(InspectionIssuesSchema, row.issues_json, []),
    createdAt: row.created_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

/** Scene Doctor reports, and the exports they can be made of. */
export class InspectionRepository {
  constructor(private readonly db: Connection) {}

  list(): Inspection[] {
    return this.db
      .all("SELECT * FROM inspections ORDER BY created_at DESC, id")
      .map(toInspection)
      .filter((item): item is Inspection => item !== null);
  }

  get(id: string): Inspection | null {
    const row = this.db.get("SELECT * FROM inspections WHERE id = :id", { id });
    return row ? toInspection(row) : null;
  }

  /** Inserts the report, or replaces the one with its id. */
  put(inspection: Inspection): void {
    this.db.run(
      `INSERT INTO inspections (id, job_id, name, source_json, thresholds_json, status,
         error, overview_json, scenes_json, issues_json, created_at, finished_at)
       VALUES (:id, :jobId, :name, :source, :thresholds, :status, :error, :overview,
         :scenes, :issues, :createdAt, :finishedAt)
       ON CONFLICT (id) DO UPDATE SET job_id = excluded.job_id,
         status = excluded.status, error = excluded.error,
         overview_json = excluded.overview_json, scenes_json = excluded.scenes_json,
         issues_json = excluded.issues_json, finished_at = excluded.finished_at`,
      {
        id: inspection.id,
        jobId: inspection.jobId,
        name: inspection.name,
        source: JSON.stringify(inspection.source),
        thresholds: JSON.stringify(inspection.thresholds),
        status: inspection.status,
        error: inspection.error,
        overview: inspection.overview
          ? JSON.stringify(inspection.overview)
          : null,
        scenes: JSON.stringify(inspection.scenes),
        issues: JSON.stringify(inspection.issues),
        createdAt: inspection.createdAt,
        finishedAt: inspection.finishedAt,
      },
    );
  }

  delete(id: string): boolean {
    return this.db.run("DELETE FROM inspections WHERE id = :id", { id }) > 0;
  }

  /** Reports left running by a previous process: their work is gone. */
  markRunningAsInterrupted(at: string): number {
    return this.db.run(
      `UPDATE inspections SET status = 'interrupted', finished_at = :at
       WHERE status IN ('pending', 'running')`,
      { at },
    );
  }

  /** Every export in the library, newest first, with where it came from. */
  exports(): DoctorExport[] {
    return this.db
      .all(
        `SELECT r.id, r.path, r.episode_id, r.duration_seconds, r.created_at,
                e.title AS episode_title, p.name AS project_name
         FROM renders r
         JOIN episodes e ON e.id = r.episode_id
         JOIN projects p ON p.id = e.project_id
         ORDER BY r.created_at DESC, r.id`,
      )
      .map((row) => ({
        renderId: row.id as string,
        path: row.path as string,
        episodeId: row.episode_id as string,
        episodeTitle: row.episode_title as string,
        projectName: row.project_name as string,
        durationSeconds: row.duration_seconds as number,
        createdAt: row.created_at as string,
      }));
  }
}
