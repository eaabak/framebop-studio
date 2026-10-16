import type {
  AnalysisSection,
  Comment,
  CommentPage,
  CommentSample,
  EvidenceReference,
  MetadataSnapshot,
  ReferenceVideo,
  ReferenceVideoSummary,
  ResearchAnalysis,
  ResearchFinding,
  ResearchProject,
  ResearchProjectPatch,
  ResearchProjectSummary,
  Transcript,
  TranscriptSegment,
} from "@framebop/core";
import { type Connection, type Row, buildAssignments } from "./connection";

const text = (row: Row, column: string): string => row[column] as string;
const optionalText = (row: Row, column: string): string | null =>
  (row[column] as string | null) ?? null;
const numeric = (row: Row, column: string): number => Number(row[column]);
const optionalNumeric = (row: Row, column: string): number | null =>
  row[column] === null || row[column] === undefined
    ? null
    : Number(row[column]);

function toProject(row: Row): ResearchProject {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    description: text(row, "description"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function toVideo(row: Row): ReferenceVideo {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    platform: "youtube",
    videoId: text(row, "video_id"),
    url: text(row, "url"),
    notes: text(row, "notes"),
    addedAt: text(row, "added_at"),
  };
}

function toSnapshot(row: Row): MetadataSnapshot {
  return {
    id: text(row, "id"),
    referenceVideoId: text(row, "reference_video_id"),
    source: text(row, "source") as MetadataSnapshot["source"],
    retrievedAt: text(row, "retrieved_at"),
    metadata: JSON.parse(
      text(row, "metadata_json"),
    ) as MetadataSnapshot["metadata"],
    fields: JSON.parse(text(row, "fields_json")) as MetadataSnapshot["fields"],
    requests: JSON.parse(text(row, "requests_json")) as string[],
    quotaUnits: numeric(row, "quota_units"),
  };
}

function toSample(row: Row): CommentSample {
  return {
    id: text(row, "id"),
    referenceVideoId: text(row, "reference_video_id"),
    source: "youtube-data-api",
    order: text(row, "sort_order") as CommentSample["order"],
    status: text(row, "status") as CommentSample["status"],
    pagesFetched: numeric(row, "pages_fetched"),
    storedCount: numeric(row, "stored_count"),
    reportedTotal: optionalNumeric(row, "reported_total"),
    startedAt: text(row, "started_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function toComment(row: Row): Comment {
  return {
    id: text(row, "id"),
    sampleId: text(row, "sample_id"),
    commentId: text(row, "comment_id"),
    text: text(row, "text"),
    likeCount: optionalNumeric(row, "like_count"),
    replyCount: optionalNumeric(row, "reply_count"),
    publishedAt: optionalText(row, "published_at"),
    position: numeric(row, "position"),
  };
}

function toTranscript(row: Row): Transcript {
  return {
    id: text(row, "id"),
    referenceVideoId: text(row, "reference_video_id"),
    source: "transcript-file",
    fileName: text(row, "file_name"),
    format: text(row, "format") as Transcript["format"],
    language: optionalText(row, "language"),
    rightsBasis: text(row, "rights_basis") as Transcript["rightsBasis"],
    rightsNote: text(row, "rights_note"),
    importedAt: text(row, "imported_at"),
    segmentCount: numeric(row, "segment_count"),
    wordCount: numeric(row, "word_count"),
    hasTimestamps: numeric(row, "has_timestamps") === 1,
    coveredSeconds: optionalNumeric(row, "covered_seconds"),
    warnings: JSON.parse(text(row, "warnings_json")) as string[],
  };
}

function toSegment(row: Row): TranscriptSegment {
  return {
    id: text(row, "id"),
    transcriptId: text(row, "transcript_id"),
    position: numeric(row, "position"),
    startMs: optionalNumeric(row, "start_ms"),
    endMs: optionalNumeric(row, "end_ms"),
    text: text(row, "text"),
  };
}

function toEvidence(row: Row): EvidenceReference {
  return {
    id: text(row, "id"),
    findingId: text(row, "finding_id"),
    position: numeric(row, "position"),
    kind: text(row, "kind") as EvidenceReference["kind"],
    targetId: text(row, "target_id"),
    locator: optionalText(row, "locator"),
    excerpt: optionalText(row, "excerpt"),
    source: text(row, "source") as EvidenceReference["source"],
    retrievedAt: text(row, "retrieved_at"),
    available: numeric(row, "available") === 1,
  };
}

/** Whether an evidence row's target still exists. */
const EVIDENCE_AVAILABLE = `
  CASE e.kind
    WHEN 'metadata-snapshot' THEN EXISTS (SELECT 1 FROM metadata_snapshots WHERE id = e.target_id)
    WHEN 'comment-sample' THEN EXISTS (SELECT 1 FROM comment_samples WHERE id = e.target_id)
    WHEN 'comment' THEN EXISTS (SELECT 1 FROM comments WHERE id = e.target_id)
    WHEN 'transcript' THEN EXISTS (SELECT 1 FROM transcripts WHERE id = e.target_id)
    WHEN 'transcript-segment' THEN EXISTS (SELECT 1 FROM transcript_segments WHERE id = e.target_id)
    ELSE 0
  END`;

const SAMPLE_COLUMNS = `s.*, (SELECT COUNT(*) FROM comments c WHERE c.sample_id = s.id) AS stored_count`;

export type StoredFinding = Omit<ResearchFinding, "evidence"> & {
  evidence: Omit<EvidenceReference, "available">[];
};

export type CommentSort = "youtube" | "likes" | "newest";

const COMMENT_ORDER: Record<CommentSort, string> = {
  youtube: "position",
  likes: "like_count IS NULL, like_count DESC, position",
  newest: "published_at IS NULL, published_at DESC, position",
};

/** Persistence for Video DNA Lab research. */
export class ResearchRepository {
  constructor(private readonly db: Connection) {}

  // ------------------------------------------------------------- projects

  listProjects(): ResearchProjectSummary[] {
    return this.db
      .all(
        `SELECT p.*, (SELECT COUNT(*) FROM reference_videos v WHERE v.project_id = p.id) AS video_count
         FROM research_projects p ORDER BY p.updated_at DESC, p.name`,
      )
      .map((row) => ({
        ...toProject(row),
        videoCount: numeric(row, "video_count"),
      }));
  }

  getProject(id: string): ResearchProject | null {
    const row = this.db.get("SELECT * FROM research_projects WHERE id = :id", {
      id,
    });
    return row ? toProject(row) : null;
  }

  insertProject(project: ResearchProject): void {
    this.db.run(
      `INSERT INTO research_projects (id, name, description, created_at, updated_at)
       VALUES (:id, :name, :description, :createdAt, :updatedAt)`,
      { ...project },
    );
  }

  updateProject(
    id: string,
    patch: ResearchProjectPatch,
    updatedAt: string,
  ): void {
    const { assignments, params } = buildAssignments(
      { name: "name", description: "description" },
      patch,
    );
    this.db.run(
      `UPDATE research_projects SET ${[...assignments, "updated_at = :updated_at"].join(", ")} WHERE id = :id`,
      { ...params, id, updated_at: updatedAt },
    );
  }

  touchProject(id: string, updatedAt: string): void {
    this.db.run(
      "UPDATE research_projects SET updated_at = :updatedAt WHERE id = :id",
      {
        id,
        updatedAt,
      },
    );
  }

  deleteProject(id: string): boolean {
    return (
      this.db.run("DELETE FROM research_projects WHERE id = :id", { id }) > 0
    );
  }

  // --------------------------------------------------------------- videos

  listVideos(projectId: string): ReferenceVideoSummary[] {
    return this.db
      .all(
        `SELECT v.*, m.source AS metadata_source, m.retrieved_at AS metadata_retrieved_at,
           json_extract(m.metadata_json, '$.title') AS title,
           json_extract(m.metadata_json, '$.channelTitle') AS channel_title,
           json_extract(m.metadata_json, '$.durationSeconds') AS duration_seconds,
           (SELECT COUNT(*) FROM comments c JOIN comment_samples s ON s.id = c.sample_id
              WHERE s.reference_video_id = v.id) AS stored_comments,
           (SELECT COUNT(*) FROM transcripts t WHERE t.reference_video_id = v.id) AS transcript_count
         FROM reference_videos v
         LEFT JOIN metadata_snapshots m ON m.id = (
           SELECT id FROM metadata_snapshots WHERE reference_video_id = v.id
           ORDER BY retrieved_at DESC, rowid DESC LIMIT 1)
         WHERE v.project_id = :projectId
         ORDER BY v.added_at, v.id`,
        { projectId },
      )
      .map((row) => ({
        ...toVideo(row),
        title: optionalText(row, "title"),
        channelTitle: optionalText(row, "channel_title"),
        durationSeconds: optionalNumeric(row, "duration_seconds"),
        metadataSource: optionalText(
          row,
          "metadata_source",
        ) as ReferenceVideoSummary["metadataSource"],
        metadataRetrievedAt: optionalText(row, "metadata_retrieved_at"),
        storedComments: numeric(row, "stored_comments"),
        transcripts: numeric(row, "transcript_count"),
      }));
  }

  getVideo(id: string): ReferenceVideo | null {
    const row = this.db.get("SELECT * FROM reference_videos WHERE id = :id", {
      id,
    });
    return row ? toVideo(row) : null;
  }

  findVideo(projectId: string, videoId: string): ReferenceVideo | null {
    const row = this.db.get(
      "SELECT * FROM reference_videos WHERE project_id = :projectId AND platform = 'youtube' AND video_id = :videoId",
      { projectId, videoId },
    );
    return row ? toVideo(row) : null;
  }

  insertVideo(video: ReferenceVideo): void {
    this.db.run(
      `INSERT INTO reference_videos (id, project_id, platform, video_id, url, notes, added_at)
       VALUES (:id, :projectId, :platform, :videoId, :url, :notes, :addedAt)`,
      { ...video },
    );
  }

  updateVideoNotes(id: string, notes: string): void {
    this.db.run("UPDATE reference_videos SET notes = :notes WHERE id = :id", {
      id,
      notes,
    });
  }

  deleteVideo(id: string): boolean {
    return (
      this.db.run("DELETE FROM reference_videos WHERE id = :id", { id }) > 0
    );
  }

  // ------------------------------------------------------------ snapshots

  insertSnapshot(snapshot: MetadataSnapshot): void {
    this.db.run(
      `INSERT INTO metadata_snapshots (id, reference_video_id, source, retrieved_at,
         metadata_json, fields_json, requests_json, quota_units)
       VALUES (:id, :referenceVideoId, :source, :retrievedAt, :metadata, :fields, :requests, :quotaUnits)`,
      {
        id: snapshot.id,
        referenceVideoId: snapshot.referenceVideoId,
        source: snapshot.source,
        retrievedAt: snapshot.retrievedAt,
        metadata: JSON.stringify(snapshot.metadata),
        fields: JSON.stringify(snapshot.fields),
        requests: JSON.stringify(snapshot.requests),
        quotaUnits: snapshot.quotaUnits,
      },
    );
  }

  getSnapshot(id: string): MetadataSnapshot | null {
    const row = this.db.get("SELECT * FROM metadata_snapshots WHERE id = :id", {
      id,
    });
    return row ? toSnapshot(row) : null;
  }

  /** Newest first. */
  listSnapshots(referenceVideoId: string): MetadataSnapshot[] {
    return this.db
      .all(
        `SELECT * FROM metadata_snapshots WHERE reference_video_id = :referenceVideoId
         ORDER BY retrieved_at DESC, rowid DESC`,
        { referenceVideoId },
      )
      .map(toSnapshot);
  }

  deleteSnapshot(id: string): boolean {
    return (
      this.db.run("DELETE FROM metadata_snapshots WHERE id = :id", { id }) > 0
    );
  }

  // ------------------------------------------------------------- comments

  getSample(
    referenceVideoId: string,
  ): (CommentSample & { nextPageToken: string | null }) | null {
    const row = this.db.get(
      `SELECT ${SAMPLE_COLUMNS} FROM comment_samples s WHERE s.reference_video_id = :referenceVideoId`,
      { referenceVideoId },
    );
    return row
      ? {
          ...toSample(row),
          nextPageToken: optionalText(row, "next_page_token"),
        }
      : null;
  }

  getSampleById(id: string): CommentSample | null {
    const row = this.db.get(
      `SELECT ${SAMPLE_COLUMNS} FROM comment_samples s WHERE s.id = :id`,
      { id },
    );
    return row ? toSample(row) : null;
  }

  insertSample(
    sample: Omit<CommentSample, "storedCount">,
    nextPageToken: string | null,
  ): void {
    this.db.run(
      `INSERT INTO comment_samples (id, reference_video_id, sort_order, status, next_page_token,
         pages_fetched, reported_total, started_at, updated_at)
       VALUES (:id, :referenceVideoId, :order, :status, :nextPageToken, :pagesFetched,
         :reportedTotal, :startedAt, :updatedAt)`,
      {
        id: sample.id,
        referenceVideoId: sample.referenceVideoId,
        order: sample.order,
        status: sample.status,
        nextPageToken,
        pagesFetched: sample.pagesFetched,
        reportedTotal: sample.reportedTotal,
        startedAt: sample.startedAt,
        updatedAt: sample.updatedAt,
      },
    );
  }

  updateSample(
    id: string,
    changes: {
      status: CommentSample["status"];
      nextPageToken: string | null;
      pagesFetched: number;
      reportedTotal: number | null;
      updatedAt: string;
    },
  ): void {
    this.db.run(
      `UPDATE comment_samples SET status = :status, next_page_token = :nextPageToken,
         pages_fetched = :pagesFetched, reported_total = :reportedTotal, updated_at = :updatedAt
       WHERE id = :id`,
      { id, ...changes },
    );
  }

  deleteSample(referenceVideoId: string): boolean {
    return (
      this.db.run(
        "DELETE FROM comment_samples WHERE reference_video_id = :referenceVideoId",
        {
          referenceVideoId,
        },
      ) > 0
    );
  }

  /** Adds comments not already in the sample. Returns how many were new. */
  insertComments(
    sampleId: string,
    comments: Omit<Comment, "sampleId" | "position">[],
  ): number {
    const start = numeric(
      this.db.get(
        "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM comments WHERE sample_id = :sampleId",
        { sampleId },
      ) ?? { next: 0 },
      "next",
    );
    let added = 0;
    for (const comment of comments) {
      added += this.db.run(
        `INSERT OR IGNORE INTO comments (id, sample_id, comment_id, text, like_count, reply_count,
           published_at, position)
         VALUES (:id, :sampleId, :commentId, :text, :likeCount, :replyCount, :publishedAt, :position)`,
        {
          id: comment.id,
          sampleId,
          commentId: comment.commentId,
          text: comment.text,
          likeCount: comment.likeCount,
          replyCount: comment.replyCount,
          publishedAt: comment.publishedAt,
          position: start + added,
        },
      );
    }
    return added;
  }

  allComments(sampleId: string): Comment[] {
    return this.db
      .all(
        "SELECT * FROM comments WHERE sample_id = :sampleId ORDER BY position",
        { sampleId },
      )
      .map(toComment);
  }

  getComment(id: string): Comment | null {
    const row = this.db.get("SELECT * FROM comments WHERE id = :id", { id });
    return row ? toComment(row) : null;
  }

  listComments(
    sampleId: string,
    options: {
      query: string;
      sort: CommentSort;
      offset: number;
      limit: number;
    },
  ): CommentPage {
    const pattern = `%${options.query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const where = "sample_id = :sampleId AND text LIKE :pattern ESCAPE '\\'";
    const total = numeric(
      this.db.get(`SELECT COUNT(*) AS total FROM comments WHERE ${where}`, {
        sampleId,
        pattern,
      }) ?? { total: 0 },
      "total",
    );
    const comments = this.db
      .all(
        `SELECT * FROM comments WHERE ${where} ORDER BY ${COMMENT_ORDER[options.sort]}
         LIMIT :limit OFFSET :offset`,
        { sampleId, pattern, limit: options.limit, offset: options.offset },
      )
      .map(toComment);
    return { comments, total };
  }

  // ---------------------------------------------------------- transcripts

  insertTranscript(
    transcript: Transcript,
    segments: Omit<TranscriptSegment, "transcriptId">[],
  ): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO transcripts (id, reference_video_id, file_name, format, language, rights_basis,
           rights_note, imported_at, segment_count, word_count, has_timestamps, covered_seconds,
           warnings_json)
         VALUES (:id, :referenceVideoId, :fileName, :format, :language, :rightsBasis, :rightsNote,
           :importedAt, :segmentCount, :wordCount, :hasTimestamps, :coveredSeconds, :warnings)`,
        {
          id: transcript.id,
          referenceVideoId: transcript.referenceVideoId,
          fileName: transcript.fileName,
          format: transcript.format,
          language: transcript.language,
          rightsBasis: transcript.rightsBasis,
          rightsNote: transcript.rightsNote,
          importedAt: transcript.importedAt,
          segmentCount: transcript.segmentCount,
          wordCount: transcript.wordCount,
          hasTimestamps: transcript.hasTimestamps ? 1 : 0,
          coveredSeconds: transcript.coveredSeconds,
          warnings: JSON.stringify(transcript.warnings),
        },
      );
      for (const segment of segments) {
        this.db.run(
          `INSERT INTO transcript_segments (id, transcript_id, position, start_ms, end_ms, text)
           VALUES (:id, :transcriptId, :position, :startMs, :endMs, :text)`,
          { ...segment, transcriptId: transcript.id },
        );
      }
    });
  }

  listTranscripts(referenceVideoId: string): Transcript[] {
    return this.db
      .all(
        "SELECT * FROM transcripts WHERE reference_video_id = :referenceVideoId ORDER BY imported_at, id",
        { referenceVideoId },
      )
      .map(toTranscript);
  }

  getTranscript(id: string): Transcript | null {
    const row = this.db.get("SELECT * FROM transcripts WHERE id = :id", { id });
    return row ? toTranscript(row) : null;
  }

  segments(transcriptId: string): TranscriptSegment[] {
    return this.db
      .all(
        "SELECT * FROM transcript_segments WHERE transcript_id = :transcriptId ORDER BY position",
        { transcriptId },
      )
      .map(toSegment);
  }

  getSegment(id: string): TranscriptSegment | null {
    const row = this.db.get(
      "SELECT * FROM transcript_segments WHERE id = :id",
      { id },
    );
    return row ? toSegment(row) : null;
  }

  deleteTranscript(id: string): boolean {
    return this.db.run("DELETE FROM transcripts WHERE id = :id", { id }) > 0;
  }

  // ------------------------------------------------------------- findings

  private insertFinding(finding: StoredFinding, position: number): void {
    this.db.run(
      `INSERT INTO research_findings (id, project_id, reference_video_id, kind, title, statement,
         basis, generator, method, uncertainty, confidence, position, created_at)
       VALUES (:id, :projectId, :referenceVideoId, :kind, :title, :statement, :basis, :generator,
         :method, :uncertainty, :confidence, :position, :createdAt)`,
      {
        id: finding.id,
        projectId: finding.projectId,
        referenceVideoId: finding.referenceVideoId,
        kind: finding.kind,
        title: finding.title,
        statement: finding.statement,
        basis: finding.basis,
        generator: finding.generator,
        method: finding.method,
        uncertainty: finding.uncertainty,
        confidence: finding.confidence,
        position,
        createdAt: finding.createdAt,
      },
    );
    for (const item of finding.evidence) {
      this.db.run(
        `INSERT INTO evidence_references (id, finding_id, position, kind, target_id, locator,
           excerpt, source, retrieved_at)
         VALUES (:id, :findingId, :position, :kind, :targetId, :locator, :excerpt, :source,
           :retrievedAt)`,
        { ...item, findingId: finding.id },
      );
    }
  }

  /** Swaps a video's rule-based findings for a freshly computed set. */
  replaceRuleFindings(
    referenceVideoId: string,
    findings: StoredFinding[],
  ): void {
    this.db.transaction(() => {
      this.db.run(
        `DELETE FROM research_findings
         WHERE reference_video_id = :referenceVideoId AND generator = 'framebop-rules'`,
        { referenceVideoId },
      );
      findings.forEach((finding, index) => this.insertFinding(finding, index));
    });
  }

  addFinding(finding: StoredFinding): void {
    this.db.transaction(() => {
      const next = numeric(
        this.db.get(
          "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM research_findings WHERE project_id = :projectId",
          { projectId: finding.projectId },
        ) ?? { next: 0 },
        "next",
      );
      this.insertFinding(finding, next);
    });
  }

  private withEvidence(rows: Row[]): ResearchFinding[] {
    return rows.map((row) => {
      const id = text(row, "id");
      return {
        id,
        projectId: text(row, "project_id"),
        referenceVideoId: optionalText(row, "reference_video_id"),
        kind: text(row, "kind") as ResearchFinding["kind"],
        title: text(row, "title"),
        statement: text(row, "statement"),
        basis: text(row, "basis") as ResearchFinding["basis"],
        generator: text(row, "generator") as ResearchFinding["generator"],
        method: text(row, "method"),
        uncertainty: optionalText(row, "uncertainty"),
        confidence: optionalText(
          row,
          "confidence",
        ) as ResearchFinding["confidence"],
        createdAt: text(row, "created_at"),
        evidence: this.db
          .all(
            `SELECT e.*, ${EVIDENCE_AVAILABLE} AS available FROM evidence_references e
             WHERE e.finding_id = :id ORDER BY e.position`,
            { id },
          )
          .map(toEvidence),
      };
    });
  }

  /** Rule-based findings first, then notes, each in the order they were made. */
  findingsForVideo(referenceVideoId: string): ResearchFinding[] {
    return this.withEvidence(
      this.db.all(
        `SELECT * FROM research_findings WHERE reference_video_id = :referenceVideoId
         ORDER BY generator <> 'framebop-rules', position, created_at`,
        { referenceVideoId },
      ),
    );
  }

  projectNotes(projectId: string): ResearchFinding[] {
    return this.withEvidence(
      this.db.all(
        `SELECT * FROM research_findings WHERE project_id = :projectId AND reference_video_id IS NULL
         ORDER BY position, created_at`,
        { projectId },
      ),
    );
  }

  getFinding(id: string): ResearchFinding | null {
    return (
      this.withEvidence(
        this.db.all("SELECT * FROM research_findings WHERE id = :id", { id }),
      )[0] ?? null
    );
  }

  deleteFinding(id: string): boolean {
    return (
      this.db.run("DELETE FROM research_findings WHERE id = :id", { id }) > 0
    );
  }

  // ------------------------------------------------------------- analyses

  insertAnalysis(analysis: Omit<ResearchAnalysis, "stale">): void {
    this.db.run(
      `INSERT INTO research_analyses (id, project_id, reference_video_id, job_id, status,
         model_id, model_name, runtime, config_json, input_fingerprint, sections_json, error,
         created_at, started_at, finished_at)
       VALUES (:id, :projectId, :referenceVideoId, :jobId, :status, :modelId, :modelName,
         :runtime, :config, :inputFingerprint, :sections, :error, :createdAt, :startedAt,
         :finishedAt)`,
      {
        id: analysis.id,
        projectId: analysis.projectId,
        referenceVideoId: analysis.referenceVideoId,
        jobId: analysis.jobId,
        status: analysis.status,
        modelId: analysis.modelId,
        modelName: analysis.modelName,
        runtime: analysis.runtime,
        config: JSON.stringify(analysis.config),
        inputFingerprint: analysis.inputFingerprint,
        sections: JSON.stringify(analysis.sections),
        error: analysis.error,
        createdAt: analysis.createdAt,
        startedAt: analysis.startedAt,
        finishedAt: analysis.finishedAt,
      },
    );
  }

  updateAnalysis(
    id: string,
    changes: Partial<{
      jobId: string | null;
      status: ResearchAnalysis["status"];
      runtime: string | null;
      sections: AnalysisSection[];
      error: string | null;
      startedAt: string | null;
      finishedAt: string | null;
    }>,
  ): void {
    const columns: Record<string, string> = {
      jobId: "job_id",
      status: "status",
      runtime: "runtime",
      sections: "sections_json",
      error: "error",
      startedAt: "started_at",
      finishedAt: "finished_at",
    };
    const values: Record<string, unknown> = {
      ...changes,
      ...(changes.sections
        ? { sections: JSON.stringify(changes.sections) }
        : {}),
    };
    const { assignments, params } = buildAssignments(columns, values);
    if (assignments.length === 0) return;
    this.db.run(
      `UPDATE research_analyses SET ${assignments.join(", ")} WHERE id = :id`,
      { ...params, id },
    );
  }

  private toAnalysis(row: Row): Omit<ResearchAnalysis, "stale"> {
    return {
      id: text(row, "id"),
      projectId: text(row, "project_id"),
      referenceVideoId: text(row, "reference_video_id"),
      jobId: optionalText(row, "job_id"),
      status: text(row, "status") as ResearchAnalysis["status"],
      modelId: text(row, "model_id"),
      modelName: text(row, "model_name"),
      runtime: optionalText(row, "runtime"),
      config: JSON.parse(
        text(row, "config_json"),
      ) as ResearchAnalysis["config"],
      inputFingerprint: text(row, "input_fingerprint"),
      sections: JSON.parse(text(row, "sections_json")) as AnalysisSection[],
      error: optionalText(row, "error"),
      createdAt: text(row, "created_at"),
      startedAt: optionalText(row, "started_at"),
      finishedAt: optionalText(row, "finished_at"),
    };
  }

  getAnalysis(id: string): Omit<ResearchAnalysis, "stale"> | null {
    const row = this.db.get("SELECT * FROM research_analyses WHERE id = :id", {
      id,
    });
    return row ? this.toAnalysis(row) : null;
  }

  /** Newest first. */
  listAnalyses(referenceVideoId: string): Omit<ResearchAnalysis, "stale">[] {
    return this.db
      .all(
        `SELECT * FROM research_analyses WHERE reference_video_id = :referenceVideoId
         ORDER BY created_at DESC, rowid DESC`,
        { referenceVideoId },
      )
      .map((row) => this.toAnalysis(row));
  }

  /**
   * Analyses that were running when the application stopped. Queued ones
   * keep waiting with their job, which the queue holds until resumed.
   */
  interruptUnfinishedAnalyses(at: string): number {
    return this.db.run(
      `UPDATE research_analyses SET status = 'interrupted', finished_at = :at,
         error = 'Framebop stopped while this analysis was running.'
       WHERE status IN ('loading-model', 'analyzing', 'validating')`,
      { at },
    );
  }

  deleteAnalysis(id: string): boolean {
    return (
      this.db.run("DELETE FROM research_analyses WHERE id = :id", { id }) > 0
    );
  }

  recordInferenceCheck(check: {
    modelId: string;
    runtime: string;
    ok: boolean;
    detail: string;
    checkedAt: string;
  }): void {
    this.db.run(
      `INSERT INTO llm_inference_checks (model_id, runtime, ok, detail, checked_at)
       VALUES (:modelId, :runtime, :ok, :detail, :checkedAt)
       ON CONFLICT (model_id, runtime) DO UPDATE SET ok = excluded.ok,
         detail = excluded.detail, checked_at = excluded.checked_at`,
      { ...check, ok: check.ok ? 1 : 0 },
    );
  }

  inferenceCheck(
    modelId: string,
    runtime: string,
  ): { ok: boolean; detail: string; checkedAt: string } | null {
    const row = this.db.get(
      "SELECT * FROM llm_inference_checks WHERE model_id = :modelId AND runtime = :runtime",
      { modelId, runtime },
    );
    return row
      ? {
          ok: numeric(row, "ok") === 1,
          detail: text(row, "detail"),
          checkedAt: text(row, "checked_at"),
        }
      : null;
  }
}
