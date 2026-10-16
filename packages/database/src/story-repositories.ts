import type {
  StoryConcept,
  StoryEditable,
  StoryGeneration,
  StoryHandoff,
} from "@framebop/core";
import type { Connection, Row } from "./connection";

/** A draft as stored: what the user and the generator wrote, nothing derived. */
export interface StoredStoryDraft extends StoryEditable {
  id: string;
  researchProjectId: string;
  referenceVideoId: string;
  concept: StoryConcept;
  revision: number;
  sourceFingerprint: string;
  generation: StoryGeneration;
  handoff: StoryHandoff | null;
  createdAt: string;
  updatedAt: string;
}

interface DraftDocument extends StoryEditable {
  concept: StoryConcept;
  generation: StoryGeneration;
}

const KEPT_REVISIONS = 30;

function toDraft(row: Row): StoredStoryDraft {
  const document = JSON.parse(row.draft_json as string) as DraftDocument;
  return {
    id: row.id as string,
    researchProjectId: row.research_project_id as string,
    referenceVideoId: row.reference_video_id as string,
    ...document,
    revision: Number(row.revision),
    sourceFingerprint: row.source_fingerprint as string,
    handoff: row.handoff_json
      ? (JSON.parse(row.handoff_json as string) as StoryHandoff)
      : null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function documentOf(draft: StoredStoryDraft): string {
  const document: DraftDocument = {
    concept: draft.concept,
    settings: draft.settings,
    outline: draft.outline,
    scenes: draft.scenes,
    generation: draft.generation,
  };
  return JSON.stringify(document);
}

export class StoryRepository {
  constructor(private readonly db: Connection) {}

  insert(draft: StoredStoryDraft): void {
    this.db.run(
      `INSERT INTO story_drafts (id, research_project_id, reference_video_id, analysis_id,
         concept_item_id, draft_json, revision, source_fingerprint, handoff_json,
         production_project_id, created_at, updated_at)
       VALUES (:id, :researchProjectId, :referenceVideoId, :analysisId, :itemId, :document,
         :revision, :sourceFingerprint, NULL, NULL, :createdAt, :updatedAt)`,
      {
        id: draft.id,
        researchProjectId: draft.researchProjectId,
        referenceVideoId: draft.referenceVideoId,
        analysisId: draft.concept.analysisId,
        itemId: draft.concept.itemId,
        document: documentOf(draft),
        revision: draft.revision,
        sourceFingerprint: draft.sourceFingerprint,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      },
    );
  }

  get(id: string): StoredStoryDraft | null {
    const row = this.db.get("SELECT * FROM story_drafts WHERE id = :id", {
      id,
    });
    return row ? toDraft(row) : null;
  }

  /** The draft not yet handed off for one concept, if there is one. */
  findOpen(analysisId: string, itemId: string): StoredStoryDraft | null {
    const row = this.db.get(
      `SELECT * FROM story_drafts WHERE analysis_id = :analysisId AND concept_item_id = :itemId
         AND handoff_json IS NULL ORDER BY created_at DESC LIMIT 1`,
      { analysisId, itemId },
    );
    return row ? toDraft(row) : null;
  }

  /** Newest first. */
  list(researchProjectId: string): StoredStoryDraft[] {
    return this.db
      .all(
        "SELECT * FROM story_drafts WHERE research_project_id = :researchProjectId ORDER BY updated_at DESC, id",
        { researchProjectId },
      )
      .map(toDraft);
  }

  /** Writes a new revision of the draft and keeps the previous ones. */
  save(draft: StoredStoryDraft): void {
    this.db.transaction(() => {
      this.db.run(
        `UPDATE story_drafts SET draft_json = :document, revision = :revision,
           handoff_json = :handoff, production_project_id = :productionProjectId,
           updated_at = :updatedAt
         WHERE id = :id`,
        {
          id: draft.id,
          document: documentOf(draft),
          revision: draft.revision,
          handoff: draft.handoff ? JSON.stringify(draft.handoff) : null,
          productionProjectId: draft.handoff?.productionProjectId ?? null,
          updatedAt: draft.updatedAt,
        },
      );
      this.db.run(
        `INSERT OR REPLACE INTO story_draft_revisions (draft_id, revision, draft_json, saved_at)
         VALUES (:id, :revision, :document, :savedAt)`,
        {
          id: draft.id,
          revision: draft.revision,
          document: documentOf(draft),
          savedAt: draft.updatedAt,
        },
      );
      this.db.run(
        "DELETE FROM story_draft_revisions WHERE draft_id = :id AND revision <= :oldest",
        { id: draft.id, oldest: draft.revision - KEPT_REVISIONS },
      );
    });
  }

  revisionCount(id: string): number {
    return Number(
      this.db.get(
        "SELECT COUNT(*) AS count FROM story_draft_revisions WHERE draft_id = :id",
        { id },
      )?.count ?? 0,
    );
  }

  delete(id: string): boolean {
    return this.db.run("DELETE FROM story_drafts WHERE id = :id", { id }) > 0;
  }

  /** Drafts whose generation was running when the application stopped. */
  running(): StoredStoryDraft[] {
    return this.db
      .all(
        `SELECT * FROM story_drafts WHERE json_extract(draft_json, '$.generation.status')
           IN ('loading-model', 'outline', 'scenes', 'validating')`,
      )
      .map(toDraft);
  }
}
