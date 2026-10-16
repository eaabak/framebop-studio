/**
 * Video DNA Lab: research projects, reference videos and what is collected
 * about them.
 *
 * Network access happens only in the "fetch" calls, only when the user asks,
 * and only to the YouTube Data API's fixed address. A link the user pastes is
 * parsed for its video id and never requested. Third-party media is never
 * downloaded. Rule-based findings are recalculated from the stored data
 * whenever it changes, so they always match it.
 */
import type { SecretStore } from "@framebop/ai-adapters";
import {
  ANALYSIS_TASKS,
  type AnalysisCapability,
  AppError,
  type CommentPage,
  type CommentSample,
  EMPTY_METADATA,
  type EvidenceKind,
  type FieldNote,
  type MetadataField,
  type MetadataSnapshot,
  type ReferenceVideo,
  type ReferenceVideoDetail,
  type ResearchFinding,
  type ResearchProject,
  type ResearchProjectDetail,
  type ResearchProjectSummary,
  type RpcParsedParams,
  TRANSCRIPT_MAX_BYTES,
  type Transcript,
  type TranscriptDetail,
  type VideoMetadata,
  type YouTubeKeyStatus,
  formatClock,
  parseYouTubeLink,
} from "@framebop/core";
import type { StoredFinding } from "@framebop/database";
import {
  type EvidenceDraft,
  PLANNED_ANALYSES,
  type YouTubeClient,
  countWords,
  coverageReport,
  coveredMs,
  detectTranscriptFormat,
  excerpt,
  normalizeVideo,
  parseTranscript,
  ruleFindings,
  youTubeError,
} from "@framebop/research";
import type { EngineContext } from "../context";
import { definedOnly } from "./shared";

/** The account name of the key in the system's secret store. */
const KEY_ACCOUNT = "youtube-data-api";

/**
 * Holds the YouTube API key: in the system's secure storage when there is
 * one, otherwise in memory until the engine stops. It is never written to
 * the database, the settings or the log, and never sent back to the UI.
 */
export class YouTubeKeyStore {
  private session: string | null = null;
  private cached: string | null | undefined;

  constructor(
    private readonly secure: SecretStore | null,
    private readonly environmentKey: string | null,
  ) {}

  private async secureAvailable(): Promise<boolean> {
    return this.secure !== null && (await this.secure.available());
  }

  private async stored(): Promise<string | null> {
    if (this.cached === undefined) {
      this.cached = (await this.secureAvailable())
        ? await (this.secure as SecretStore).get(KEY_ACCOUNT)
        : null;
    }
    return this.cached;
  }

  async key(): Promise<string | null> {
    return this.environmentKey ?? this.session ?? (await this.stored());
  }

  async status(problem: string | null = null): Promise<YouTubeKeyStatus> {
    const secureName = (await this.secureAvailable())
      ? (this.secure as SecretStore).name
      : null;
    if (this.environmentKey) {
      return {
        configured: true,
        source: "environment",
        secureStorage: secureName,
        note: "Read from the FRAMEBOP_YOUTUBE_API_KEY environment variable, which overrides a saved key. It is not stored.",
      };
    }
    if (this.session) {
      return {
        configured: true,
        source: "session",
        secureStorage: secureName,
        note:
          problem ??
          "Kept in memory until Framebop closes, because this computer has no secure storage Framebop can use.",
      };
    }
    if (await this.stored()) {
      return {
        configured: true,
        source: "secure-storage",
        secureStorage: secureName,
        note: `Kept in the ${secureName}. Framebop never writes it to the library, the settings or the log.`,
      };
    }
    return {
      configured: false,
      source: null,
      secureStorage: secureName,
      note: secureName
        ? `A key you enter is kept in the ${secureName}.`
        : "This computer has no secure storage Framebop can use, so a key you enter is kept only until Framebop closes.",
    };
  }

  async set(key: string): Promise<YouTubeKeyStatus> {
    if (await this.secureAvailable()) {
      const secure = this.secure as SecretStore;
      try {
        await secure.set(KEY_ACCOUNT, key);
        this.cached = key;
        this.session = null;
        return this.status();
      } catch {
        this.session = key;
        return this.status(
          `The ${secure.name} did not accept the key, so it is kept in memory until Framebop closes.`,
        );
      }
    }
    this.session = key;
    return this.status();
  }

  async clear(): Promise<YouTubeKeyStatus> {
    this.session = null;
    if (await this.secureAvailable()) {
      await (this.secure as SecretStore).delete(KEY_ACCOUNT);
    }
    this.cached = null;
    return this.status();
  }
}

const MANUAL_FIELDS = [
  "title",
  "channelTitle",
  "publishedAt",
  "durationSeconds",
  "viewCount",
  "likeCount",
  "commentCount",
  "defaultAudioLanguage",
  "description",
] as const satisfies readonly MetadataField[];

export class ResearchService {
  private readonly log;
  /** Network work under way, so the same request is not sent twice. */
  private readonly busy = new Set<string>();

  constructor(
    private readonly ctx: EngineContext,
    private readonly youtube: YouTubeClient,
    readonly keys: YouTubeKeyStore,
  ) {
    this.log = ctx.log.scope("research");
  }

  // ------------------------------------------------------------- projects

  listProjects(): ResearchProjectSummary[] {
    return this.ctx.db.research.listProjects();
  }

  private requireProject(id: string): ResearchProject {
    const project = this.ctx.db.research.getProject(id);
    if (!project)
      throw new AppError(
        "NOT_FOUND",
        "That research project no longer exists.",
      );
    return project;
  }

  private requireVideo(id: string): ReferenceVideo {
    const video = this.ctx.db.research.getVideo(id);
    if (!video)
      throw new AppError("NOT_FOUND", "That reference video no longer exists.");
    return video;
  }

  createProject(
    input: RpcParsedParams<"research.projects.create">,
  ): ResearchProject {
    const now = this.ctx.now();
    const project: ResearchProject = {
      id: this.ctx.newId(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.db.research.insertProject(project);
    this.log.info("Created research project", { projectId: project.id });
    return project;
  }

  updateProject({
    id,
    patch,
  }: RpcParsedParams<"research.projects.update">): ResearchProject {
    this.requireProject(id);
    this.ctx.db.research.updateProject(id, definedOnly(patch), this.ctx.now());
    return this.requireProject(id);
  }

  deleteProject(id: string): void {
    this.requireProject(id);
    this.ctx.db.research.deleteProject(id);
    this.log.info("Deleted research project", { projectId: id });
  }

  projectDetail(id: string): ResearchProjectDetail {
    return {
      project: this.requireProject(id),
      videos: this.ctx.db.research.listVideos(id),
      notes: this.ctx.db.research.projectNotes(id),
    };
  }

  // --------------------------------------------------------------- videos

  addVideo(projectId: string, link: string): ReferenceVideo {
    this.requireProject(projectId);
    const parsed = parseYouTubeLink(link);
    if (!parsed.ok) throw new AppError("VALIDATION", parsed.reason);
    if (this.ctx.db.research.findVideo(projectId, parsed.videoId)) {
      throw new AppError("CONFLICT", "This video is already in the project.");
    }
    const video: ReferenceVideo = {
      id: this.ctx.newId(),
      projectId,
      platform: "youtube",
      videoId: parsed.videoId,
      url: parsed.canonicalUrl,
      notes: "",
      addedAt: this.ctx.now(),
    };
    this.ctx.db.research.insertVideo(video);
    this.ctx.db.research.touchProject(projectId, video.addedAt);
    return video;
  }

  updateVideoNotes(id: string, notes: string): ReferenceVideo {
    this.requireVideo(id);
    this.ctx.db.research.updateVideoNotes(id, notes);
    return this.requireVideo(id);
  }

  removeVideo(id: string): void {
    const video = this.requireVideo(id);
    this.ctx.db.research.deleteVideo(id);
    this.ctx.db.research.touchProject(video.projectId, this.ctx.now());
  }

  videoDetail(id: string): ReferenceVideoDetail {
    const video = this.requireVideo(id);
    const snapshots = this.ctx.db.research.listSnapshots(id);
    const stored = this.ctx.db.research.getSample(id);
    const transcripts = this.ctx.db.research.listTranscripts(id);
    const snapshot = snapshots[0] ?? null;
    const commentSample = stored ? withoutToken(stored) : null;
    return {
      video,
      snapshot,
      snapshots: snapshots.map(({ id: snapshotId, source, retrievedAt }) => ({
        id: snapshotId,
        source,
        retrievedAt,
      })),
      commentSample,
      transcripts,
      findings: this.ctx.db.research.findingsForVideo(id),
      coverage: coverageReport({
        snapshot,
        sample: commentSample,
        transcripts,
      }),
    };
  }

  // ------------------------------------------------------------- network

  private async withKey<T>(
    task: string,
    work: (key: string) => Promise<T>,
  ): Promise<T> {
    const key = await this.keys.key();
    if (!key) {
      throw youTubeError(
        "key-missing",
        "Add a YouTube Data API key in Settings to fetch from YouTube, or enter the details by hand.",
      );
    }
    if (this.busy.has(task)) {
      throw new AppError("CONFLICT", "That is already being fetched.");
    }
    this.busy.add(task);
    try {
      return await work(key);
    } catch (error) {
      if (error instanceof AppError) {
        this.log.warn("YouTube request failed", {
          reason:
            (error.details as { reason?: string } | undefined)?.reason ??
            error.code,
        });
      }
      throw error;
    } finally {
      this.busy.delete(task);
    }
  }

  async fetchMetadata(referenceVideoId: string): Promise<MetadataSnapshot> {
    const video = this.requireVideo(referenceVideoId);
    return this.withKey(`metadata:${video.id}`, async (key) => {
      const item = await this.youtube.video(video.videoId, key);
      if (!item) {
        throw youTubeError(
          "not-found",
          "YouTube has no public video with this id. It may be private, unlisted or removed.",
        );
      }
      const channelId = normalizeVideo(item, null).metadata.channelId;
      const channel = channelId
        ? await this.youtube.channel(channelId, key)
        : null;
      const { metadata, fields } = normalizeVideo(item, channel);
      const snapshot: MetadataSnapshot = {
        id: this.ctx.newId(),
        referenceVideoId: video.id,
        source: "youtube-data-api",
        retrievedAt: this.ctx.now(),
        metadata,
        fields,
        requests: [
          "videos.list (snippet, contentDetails, statistics, status, topicDetails)",
          ...(channelId ? ["channels.list (snippet, statistics)"] : []),
        ],
        quotaUnits: channelId ? 2 : 1,
      };
      // The video may have been removed while the request was out.
      this.requireVideo(video.id);
      this.ctx.db.research.insertSnapshot(snapshot);
      this.refreshFindings(video.id);
      this.log.info("Fetched video metadata", {
        referenceVideoId: video.id,
        quotaUnits: snapshot.quotaUnits,
      });
      return snapshot;
    });
  }

  saveManualMetadata({
    referenceVideoId,
    values,
  }: RpcParsedParams<"research.metadata.saveManual">): MetadataSnapshot {
    this.requireVideo(referenceVideoId);
    const metadata: VideoMetadata = { ...EMPTY_METADATA };
    const fields: Partial<Record<MetadataField, FieldNote>> = {};
    for (const field of MANUAL_FIELDS) {
      const value = values[field];
      if (value === null || value === "") {
        fields[field] = { state: "not-provided", note: "Not entered." };
      } else {
        (metadata as Record<MetadataField, unknown>)[field] = value;
      }
    }
    if (Object.keys(fields).length === MANUAL_FIELDS.length) {
      throw new AppError("VALIDATION", "Enter at least one detail.");
    }
    const snapshot: MetadataSnapshot = {
      id: this.ctx.newId(),
      referenceVideoId,
      source: "manual",
      retrievedAt: this.ctx.now(),
      metadata,
      fields,
      requests: [],
      quotaUnits: 0,
    };
    this.ctx.db.research.insertSnapshot(snapshot);
    this.refreshFindings(referenceVideoId);
    return snapshot;
  }

  deleteSnapshot(id: string): void {
    const snapshot = this.ctx.db.research.getSnapshot(id);
    if (!snapshot)
      throw new AppError("NOT_FOUND", "That snapshot no longer exists.");
    this.ctx.db.research.deleteSnapshot(id);
    this.refreshFindings(snapshot.referenceVideoId);
  }

  async fetchComments({
    referenceVideoId,
    order,
    mode,
  }: RpcParsedParams<"research.comments.fetch">): Promise<CommentSample> {
    const video = this.requireVideo(referenceVideoId);
    const existing = this.ctx.db.research.getSample(video.id);
    if (
      mode === "more" &&
      (!existing ||
        existing.status !== "more-available" ||
        !existing.nextPageToken)
    ) {
      throw new AppError(
        "CONFLICT",
        "There are no more comments to fetch. Start over to fetch them again.",
      );
    }
    const sampleOrder = mode === "more" && existing ? existing.order : order;
    return this.withKey(`comments:${video.id}`, async (key) => {
      const page = await this.youtube.commentPage(
        {
          videoId: video.videoId,
          order: sampleOrder,
          pageToken: mode === "more" ? (existing?.nextPageToken ?? null) : null,
        },
        key,
      );
      this.requireVideo(video.id);
      const now = this.ctx.now();
      const latest = this.ctx.db.research.listSnapshots(video.id)[0];
      const reportedTotal =
        latest?.source === "youtube-data-api"
          ? latest.metadata.commentCount
          : null;

      this.ctx.db.transaction(() => {
        let sampleId = existing?.id ?? null;
        let pages = existing?.pagesFetched ?? 0;
        if (mode === "start") {
          this.ctx.db.research.deleteSample(video.id);
          sampleId = this.ctx.newId();
          pages = 0;
          this.ctx.db.research.insertSample(
            {
              id: sampleId,
              referenceVideoId: video.id,
              source: "youtube-data-api",
              order: sampleOrder,
              status: "more-available",
              pagesFetched: 0,
              reportedTotal,
              startedAt: now,
              updatedAt: now,
            },
            null,
          );
        }
        const id = sampleId as string;
        if (page) {
          this.ctx.db.research.insertComments(
            id,
            page.comments.map((comment) => ({
              id: this.ctx.newId(),
              ...comment,
            })),
          );
        }
        this.ctx.db.research.updateSample(id, {
          status:
            page === null
              ? "comments-disabled"
              : page.nextPageToken
                ? "more-available"
                : "complete",
          nextPageToken: page?.nextPageToken ?? null,
          pagesFetched: page === null ? pages : pages + 1,
          reportedTotal,
          updatedAt: now,
        });
      });
      this.refreshFindings(video.id);
      const sample = this.ctx.db.research.getSample(video.id);
      if (!sample)
        throw new AppError("INTERNAL", "The comment sample was not saved.");
      this.log.info("Fetched comments", {
        referenceVideoId: video.id,
        stored: sample.storedCount,
        status: sample.status,
      });
      return withoutToken(sample);
    });
  }

  listComments(params: RpcParsedParams<"research.comments.list">): CommentPage {
    this.requireVideo(params.referenceVideoId);
    const sample = this.ctx.db.research.getSample(params.referenceVideoId);
    if (!sample) return { comments: [], total: 0 };
    return this.ctx.db.research.listComments(sample.id, {
      query: params.query.trim(),
      sort: params.sort,
      offset: params.offset,
      limit: params.limit,
    });
  }

  clearComments(referenceVideoId: string): void {
    this.requireVideo(referenceVideoId);
    this.ctx.db.research.deleteSample(referenceVideoId);
    this.refreshFindings(referenceVideoId);
  }

  // ---------------------------------------------------------- transcripts

  importTranscript(
    input: RpcParsedParams<"research.transcripts.import">,
  ): Transcript {
    const video = this.requireVideo(input.referenceVideoId);
    if (Buffer.byteLength(input.content, "utf8") > TRANSCRIPT_MAX_BYTES) {
      throw new AppError("VALIDATION", "The transcript is larger than 5 MB.");
    }
    const format =
      input.format ?? detectTranscriptFormat(input.fileName, input.content);
    const parsed = parseTranscript(input.content, format);
    const covered = coveredMs(parsed.segments);
    const warnings = [...parsed.warnings];
    const duration =
      this.ctx.db.research.listSnapshots(video.id)[0]?.metadata
        .durationSeconds ?? null;
    const lastMs = Math.max(
      0,
      ...parsed.segments.map(
        (segment) => segment.endMs ?? segment.startMs ?? 0,
      ),
    );
    if (duration !== null && lastMs / 1000 > duration + 5) {
      warnings.push(
        `The transcript runs past the end of the video (${formatClock(duration)}). It may belong to another video or version.`,
      );
    }
    const transcript: Transcript = {
      id: this.ctx.newId(),
      referenceVideoId: video.id,
      source: "transcript-file",
      fileName: input.fileName,
      format,
      language: input.language || null,
      rightsBasis: input.rightsBasis,
      rightsNote: input.rightsNote,
      importedAt: this.ctx.now(),
      segmentCount: parsed.segments.length,
      wordCount: parsed.segments.reduce(
        (total, segment) => total + countWords(segment.text),
        0,
      ),
      hasTimestamps: parsed.hasTimestamps,
      coveredSeconds: covered === null ? null : covered / 1000,
      warnings,
    };
    this.ctx.db.research.insertTranscript(
      transcript,
      parsed.segments.map((segment, position) => ({
        id: this.ctx.newId(),
        position,
        ...segment,
      })),
    );
    this.refreshFindings(video.id);
    this.log.info("Imported transcript", {
      referenceVideoId: video.id,
      format,
      segments: transcript.segmentCount,
    });
    return transcript;
  }

  transcript(id: string): TranscriptDetail {
    const transcript = this.ctx.db.research.getTranscript(id);
    if (!transcript)
      throw new AppError("NOT_FOUND", "That transcript no longer exists.");
    return { transcript, segments: this.ctx.db.research.segments(id) };
  }

  deleteTranscript(id: string): void {
    const transcript = this.ctx.db.research.getTranscript(id);
    if (!transcript)
      throw new AppError("NOT_FOUND", "That transcript no longer exists.");
    this.ctx.db.research.deleteTranscript(id);
    this.refreshFindings(transcript.referenceVideoId);
  }

  // ------------------------------------------------------------- findings

  /** Recomputes a video's rule-based findings from what is stored now. */
  private refreshFindings(referenceVideoId: string): void {
    const video = this.ctx.db.research.getVideo(referenceVideoId);
    if (!video) return;
    const db = this.ctx.db.research;
    const sample = db.getSample(video.id);
    const transcripts = db.listTranscripts(video.id);
    const drafts = ruleFindings({
      snapshot: db.listSnapshots(video.id)[0] ?? null,
      sample: sample ? withoutToken(sample) : null,
      comments: sample ? db.allComments(sample.id) : [],
      transcripts: transcripts.map((transcript) => ({
        transcript,
        segments: db.segments(transcript.id),
      })),
    });
    const now = this.ctx.now();
    db.replaceRuleFindings(
      video.id,
      drafts.map((draft) =>
        this.stored(draft, video.projectId, video.id, "framebop-rules", now),
      ),
    );
    db.touchProject(video.projectId, now);
  }

  private stored(
    draft: Omit<
      StoredFinding,
      | "id"
      | "projectId"
      | "referenceVideoId"
      | "generator"
      | "createdAt"
      | "evidence"
    > & {
      evidence: EvidenceDraft[];
    },
    projectId: string,
    referenceVideoId: string | null,
    generator: StoredFinding["generator"],
    createdAt: string,
  ): StoredFinding {
    const id = this.ctx.newId();
    return {
      ...draft,
      id,
      projectId,
      referenceVideoId,
      generator,
      createdAt,
      evidence: draft.evidence.map((item, position) => ({
        ...item,
        id: this.ctx.newId(),
        findingId: id,
        position,
      })),
    };
  }

  /** The stored form of an item the user cites, checked to be in the project. */
  private evidenceFor(
    projectId: string,
    referenceVideoId: string | null,
    kind: EvidenceKind,
    targetId: string,
  ): EvidenceDraft {
    const db = this.ctx.db.research;
    const belongs = (videoId: string) => {
      const owner = db.getVideo(videoId);
      return (
        owner !== null &&
        owner.projectId === projectId &&
        (referenceVideoId === null || owner.id === referenceVideoId)
      );
    };
    const refuse = () =>
      new AppError(
        "VALIDATION",
        "Evidence must come from this project's collected data.",
      );

    if (kind === "comment") {
      const comment = db.getComment(targetId);
      const sample = comment ? db.getSampleById(comment.sampleId) : null;
      if (!comment || !sample || !belongs(sample.referenceVideoId))
        throw refuse();
      return {
        kind,
        targetId,
        locator:
          comment.likeCount !== null
            ? `${comment.likeCount.toLocaleString("en-US")} likes`
            : null,
        excerpt: excerpt(comment.text),
        source: "youtube-data-api",
        retrievedAt: sample.updatedAt,
      };
    }
    if (kind === "transcript-segment") {
      const segment = db.getSegment(targetId);
      const transcript = segment
        ? db.getTranscript(segment.transcriptId)
        : null;
      if (!segment || !transcript || !belongs(transcript.referenceVideoId))
        throw refuse();
      return {
        kind,
        targetId,
        locator:
          segment.startMs !== null
            ? `${formatClock(segment.startMs / 1000)}${segment.endMs !== null ? `–${formatClock(segment.endMs / 1000)}` : ""}`
            : `segment ${segment.position + 1}`,
        excerpt: excerpt(segment.text),
        source: "transcript-file",
        retrievedAt: transcript.importedAt,
      };
    }
    if (kind === "transcript") {
      const transcript = db.getTranscript(targetId);
      if (!transcript || !belongs(transcript.referenceVideoId)) throw refuse();
      return {
        kind,
        targetId,
        locator: null,
        excerpt: transcript.fileName,
        source: "transcript-file",
        retrievedAt: transcript.importedAt,
      };
    }
    if (kind === "metadata-snapshot") {
      const snapshot = db.getSnapshot(targetId);
      if (!snapshot || !belongs(snapshot.referenceVideoId)) throw refuse();
      return {
        kind,
        targetId,
        locator: null,
        excerpt: snapshot.metadata.title,
        source: snapshot.source,
        retrievedAt: snapshot.retrievedAt,
      };
    }
    const sample = db.getSampleById(targetId);
    if (!sample || !belongs(sample.referenceVideoId)) throw refuse();
    return {
      kind,
      targetId,
      locator: null,
      excerpt: `${sample.storedCount.toLocaleString("en-US")} comments`,
      source: "youtube-data-api",
      retrievedAt: sample.updatedAt,
    };
  }

  createNote(input: RpcParsedParams<"research.notes.create">): ResearchFinding {
    this.requireProject(input.projectId);
    if (input.referenceVideoId !== null) {
      const video = this.requireVideo(input.referenceVideoId);
      if (video.projectId !== input.projectId) {
        throw new AppError(
          "VALIDATION",
          "That video belongs to another project.",
        );
      }
    }
    const evidence = input.evidence.map((item) =>
      this.evidenceFor(
        input.projectId,
        input.referenceVideoId,
        item.kind,
        item.targetId,
      ),
    );
    const note = this.stored(
      {
        kind: "note",
        title: input.title,
        statement: input.statement,
        basis: input.basis,
        method: "Written by you.",
        uncertainty: null,
        confidence: null,
        evidence,
      },
      input.projectId,
      input.referenceVideoId,
      "user",
      this.ctx.now(),
    );
    this.ctx.db.research.addFinding(note);
    this.ctx.db.research.touchProject(input.projectId, note.createdAt);
    const saved = this.ctx.db.research.getFinding(note.id);
    if (!saved) throw new AppError("INTERNAL", "The note was not saved.");
    return saved;
  }

  deleteNote(id: string): void {
    const finding = this.ctx.db.research.getFinding(id);
    if (!finding)
      throw new AppError("NOT_FOUND", "That note no longer exists.");
    if (finding.generator !== "user") {
      throw new AppError(
        "CONFLICT",
        "Rule-based findings are recalculated from the collected data. Remove the data they rest on instead.",
      );
    }
    this.ctx.db.research.deleteFinding(id);
  }

  analysisCapabilities(readiness: {
    available: boolean;
    reason: string;
  }): AnalysisCapability[] {
    return ANALYSIS_TASKS.map((task) => ({
      task,
      ...PLANNED_ANALYSES[task],
      ...readiness,
    }));
  }
}

function withoutToken(
  sample: CommentSample & { nextPageToken: string | null },
): CommentSample {
  const { nextPageToken: _token, ...rest } = sample;
  return rest;
}
