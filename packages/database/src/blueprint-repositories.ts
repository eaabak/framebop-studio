import {
  AnimationSpecSchema,
  SceneShotsSchema,
  type ScenePlan,
  type VisualReference,
} from "@framebop/core";
import type { Connection, Row } from "./connection";

function toPlan(row: Row): ScenePlan {
  return {
    sceneId: row.scene_id as string,
    method: row.method as ScenePlan["method"],
    engineId: (row.engine_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    requiredAssets: JSON.parse(row.required_assets_json as string) as string[],
    claims: JSON.parse(row.claims_json as string) as string[],
    research: JSON.parse(row.research_json as string) as ScenePlan["research"],
    durationSource: row.duration_source as ScenePlan["durationSource"],
    notes: row.notes as string,
    proposedNarration: (row.proposed_narration as string | null) ?? null,
    proposalJobId: (row.proposal_job_id as string | null) ?? null,
    storyDraftId: (row.story_draft_id as string | null) ?? null,
    draftSceneId: (row.draft_scene_id as string | null) ?? null,
    animation: animationOf(row.animation_json as string | null),
    visualReferenceIds: JSON.parse(
      (row.visual_reference_ids_json as string | undefined) ?? "[]",
    ) as string[],
    ...assemblyOf(row.assembly_json as string | undefined),
    updatedAt: row.updated_at as string,
  };
}

function toReference(row: Row): VisualReference {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    kind: row.kind as VisualReference["kind"],
    name: row.name as string,
    description: row.description as string,
    palette: row.palette as string,
    assetIds: JSON.parse(row.asset_ids_json as string) as string[],
    seed: (row.seed as number | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Characters, places and styles that a project's scenes share. */
export class VisualReferenceRepository {
  constructor(private readonly db: Connection) {}

  list(projectId: string): VisualReference[] {
    return this.db
      .all(
        "SELECT * FROM visual_references WHERE project_id = :projectId ORDER BY kind, name",
        { projectId },
      )
      .map(toReference);
  }

  get(id: string): VisualReference | null {
    const row = this.db.get("SELECT * FROM visual_references WHERE id = :id", {
      id,
    });
    return row ? toReference(row) : null;
  }

  /** Inserts the reference, or replaces the one with its id. */
  put(reference: VisualReference): void {
    this.db.run(
      `INSERT INTO visual_references (id, project_id, kind, name, description, palette,
         asset_ids_json, seed, created_at, updated_at)
       VALUES (:id, :projectId, :kind, :name, :description, :palette, :assetIds, :seed,
         :createdAt, :updatedAt)
       ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
         description = excluded.description, palette = excluded.palette,
         asset_ids_json = excluded.asset_ids_json, seed = excluded.seed,
         updated_at = excluded.updated_at`,
      {
        id: reference.id,
        projectId: reference.projectId,
        kind: reference.kind,
        name: reference.name,
        description: reference.description,
        palette: reference.palette,
        assetIds: JSON.stringify(reference.assetIds),
        seed: reference.seed,
        createdAt: reference.createdAt,
        updatedAt: reference.updatedAt,
      },
    );
  }

  delete(id: string): boolean {
    return (
      this.db.run("DELETE FROM visual_references WHERE id = :id", { id }) > 0
    );
  }
}

/** A scene's shots and subtitle text; what no longer validates is dropped. */
function assemblyOf(
  json: string | undefined,
): Pick<ScenePlan, "shots" | "captionText"> {
  try {
    const value = JSON.parse(json ?? "{}") as Record<string, unknown>;
    const shots = SceneShotsSchema.safeParse(value.shots ?? []);
    return {
      shots: shots.success ? shots.data : [],
      captionText:
        typeof value.captionText === "string" ? value.captionText : null,
    };
  } catch {
    return { shots: [], captionText: null };
  }
}

/** A stored animation, or null if there is none or it no longer validates. */
function animationOf(json: string | null): ScenePlan["animation"] {
  if (json === null) return null;
  try {
    const parsed = AnimationSpecSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Production plans of scenes (Production Blueprint). */
export class ScenePlanRepository {
  constructor(private readonly db: Connection) {}

  get(sceneId: string): ScenePlan | null {
    const row = this.db.get(
      "SELECT * FROM scene_plans WHERE scene_id = :sceneId",
      { sceneId },
    );
    return row ? toPlan(row) : null;
  }

  forEpisode(episodeId: string): Map<string, ScenePlan> {
    const rows = this.db.all(
      `SELECT p.* FROM scene_plans p JOIN scenes s ON s.id = p.scene_id
       WHERE s.episode_id = :episodeId`,
      { episodeId },
    );
    return new Map(rows.map((row) => [row.scene_id as string, toPlan(row)]));
  }

  /** Inserts the plan, or replaces the scene's existing one. */
  put(plan: ScenePlan): void {
    this.db.run(
      `INSERT INTO scene_plans (scene_id, method, engine_id, model, required_assets_json,
         claims_json, research_json, duration_source, notes, proposed_narration,
         proposal_job_id, story_draft_id, draft_scene_id, animation_json,
         visual_reference_ids_json, assembly_json, updated_at)
       VALUES (:sceneId, :method, :engineId, :model, :requiredAssets, :claims, :research,
         :durationSource, :notes, :proposedNarration, :proposalJobId, :storyDraftId,
         :draftSceneId, :animation, :visualReferenceIds, :assembly, :updatedAt)
       ON CONFLICT (scene_id) DO UPDATE SET method = excluded.method,
         engine_id = excluded.engine_id, model = excluded.model,
         required_assets_json = excluded.required_assets_json,
         claims_json = excluded.claims_json, research_json = excluded.research_json,
         duration_source = excluded.duration_source, notes = excluded.notes,
         proposed_narration = excluded.proposed_narration,
         proposal_job_id = excluded.proposal_job_id,
         story_draft_id = excluded.story_draft_id,
         draft_scene_id = excluded.draft_scene_id,
         animation_json = excluded.animation_json,
         visual_reference_ids_json = excluded.visual_reference_ids_json,
         assembly_json = excluded.assembly_json,
         updated_at = excluded.updated_at`,
      {
        sceneId: plan.sceneId,
        method: plan.method,
        engineId: plan.engineId,
        model: plan.model,
        requiredAssets: JSON.stringify(plan.requiredAssets),
        claims: JSON.stringify(plan.claims),
        research: JSON.stringify(plan.research),
        durationSource: plan.durationSource,
        notes: plan.notes,
        proposedNarration: plan.proposedNarration,
        proposalJobId: plan.proposalJobId,
        storyDraftId: plan.storyDraftId,
        draftSceneId: plan.draftSceneId,
        animation: plan.animation ? JSON.stringify(plan.animation) : null,
        visualReferenceIds: JSON.stringify(plan.visualReferenceIds),
        assembly: JSON.stringify({
          shots: plan.shots,
          captionText: plan.captionText,
        }),
        updatedAt: plan.updatedAt,
      },
    );
  }
}
