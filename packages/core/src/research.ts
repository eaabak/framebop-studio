/**
 * Video DNA Lab: research on reference videos.
 *
 * Every value here records where it came from and when. Nothing is
 * estimated: a value the source did not provide is null, and a note says why
 * when the reason is known. Findings say whether they were observed in the
 * collected data or inferred from it, and point at their evidence.
 */
import { z } from "zod";
import { IdSchema } from "./domain";

const Timestamp = z.string();

// ------------------------------------------------------------ YouTube links

// Both runtimes that use core (Node.js and the webview) have the WHATWG URL
// parser; core itself compiles against ES2023 only, so it is declared here.
declare const URL: new (input: string) => {
  protocol: string;
  username: string;
  password: string;
  port: string;
  hostname: string;
  pathname: string;
  searchParams: { get(name: string): string | null };
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);
/** Paths whose next segment is the video id, as in /shorts/{id}. */
const ID_PATH_PREFIXES = new Set(["shorts", "embed", "live", "v", "e"]);

export type YouTubeLink =
  | { ok: true; videoId: string; canonicalUrl: string }
  | { ok: false; reason: string };

export function isYouTubeVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Finds the video id in a YouTube link. The link itself is never fetched:
 * only the id is used, against the fixed address of the YouTube Data API,
 * so text pasted here cannot point Framebop at any other server.
 */
export function parseYouTubeLink(input: string): YouTubeLink {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "Paste a YouTube video link." };
  if (text.length > 2048)
    return { ok: false, reason: "That link is too long." };
  if (VIDEO_ID.test(text)) {
    return { ok: true, videoId: text, canonicalUrl: youTubeWatchUrl(text) };
  }

  let url: InstanceType<typeof URL>;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "That is not a valid link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only web links (https) are supported." };
  }
  if (url.username || url.password || url.port) {
    return { ok: false, reason: "That is not a YouTube video link." };
  }
  const host = url.hostname.toLowerCase();
  if (!VIDEO_HOSTS.has(host)) {
    return { ok: false, reason: "Only YouTube video links are supported." };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = segments[0] ?? null;
  } else if (segments[0] === "watch") {
    candidate = url.searchParams.get("v");
  } else if (segments[0] && ID_PATH_PREFIXES.has(segments[0])) {
    candidate = segments[1] ?? null;
  } else if (
    segments[0]?.startsWith("@") ||
    ["channel", "c", "user"].includes(segments[0] ?? "")
  ) {
    return {
      ok: false,
      reason: "That is a link to a channel. Paste a link to one video.",
    };
  } else if (segments[0] === "playlist") {
    return {
      ok: false,
      reason: "That is a link to a playlist. Paste a link to one video.",
    };
  }

  if (candidate === null || candidate === "") {
    return { ok: false, reason: "That link does not point to a video." };
  }
  if (!VIDEO_ID.test(candidate)) {
    return {
      ok: false,
      reason: "That link does not contain a valid YouTube video id.",
    };
  }
  return {
    ok: true,
    videoId: candidate,
    canonicalUrl: youTubeWatchUrl(candidate),
  };
}

// ----------------------------------------------------------------- sources

export const RESEARCH_SOURCES = [
  "youtube-data-api",
  "manual",
  "transcript-file",
  "framebop-rules",
  "user",
] as const;
export const ResearchSourceSchema = z.enum(RESEARCH_SOURCES);
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const RESEARCH_SOURCE_LABELS: Record<ResearchSource, string> = {
  "youtube-data-api": "YouTube Data API",
  manual: "Entered by you",
  "transcript-file": "Imported transcript",
  "framebop-rules": "Framebop rules (no AI)",
  user: "Your note",
};

/**
 * Stored data from the YouTube API must be refreshed or deleted after this
 * many days (YouTube API Services Developer Policies, III.E.4).
 */
export const YOUTUBE_DATA_MAX_AGE_DAYS = 30;

export function isOlderThanDays(
  timestamp: string,
  days: number,
  now: Date = new Date(),
): boolean {
  const time = Date.parse(timestamp);
  return (
    Number.isFinite(time) && now.getTime() - time > days * 24 * 60 * 60 * 1000
  );
}

// ---------------------------------------------------------------- projects

const projectFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  /** What the research is for, in the user's words. */
  description: z.string().max(4000),
};

export const ResearchProjectSchema = z.object({
  id: IdSchema,
  ...projectFields,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ResearchProject = z.infer<typeof ResearchProjectSchema>;

export const ResearchProjectSummarySchema = ResearchProjectSchema.extend({
  videoCount: z.number().int().nonnegative(),
});
export type ResearchProjectSummary = z.infer<
  typeof ResearchProjectSummarySchema
>;

export const ResearchProjectCreateSchema = z.strictObject({
  name: projectFields.name,
  description: projectFields.description.default(""),
});
export const ResearchProjectPatchSchema = z
  .strictObject(projectFields)
  .partial();
export type ResearchProjectPatch = z.infer<typeof ResearchProjectPatchSchema>;

// ---------------------------------------------------------------- metadata

/**
 * What is known about a video. Every field is null when the source did not
 * provide it; `MetadataSnapshot.fields` says why, when that is known.
 */
export const VideoMetadataSchema = z.object({
  title: z.string().max(500).nullable(),
  description: z.string().max(10_000).nullable(),
  publishedAt: Timestamp.nullable(),
  durationSeconds: z.number().nonnegative().max(1_000_000).nullable(),
  channelId: z.string().max(100).nullable(),
  channelTitle: z.string().max(500).nullable(),
  viewCount: z.number().int().nonnegative().nullable(),
  likeCount: z.number().int().nonnegative().nullable(),
  commentCount: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string().max(500)).max(500).nullable(),
  categoryId: z.string().max(20).nullable(),
  defaultLanguage: z.string().max(35).nullable(),
  defaultAudioLanguage: z.string().max(35).nullable(),
  /** Whether the video has captions, per the API. Their text is not retrieved. */
  captionsAvailable: z.boolean().nullable(),
  definition: z.enum(["hd", "sd"]).nullable(),
  liveBroadcastContent: z.enum(["none", "live", "upcoming"]).nullable(),
  madeForKids: z.boolean().nullable(),
  topicCategories: z.array(z.string().max(500)).max(50).nullable(),
  /** Recorded, never loaded: Framebop does not download third-party media. */
  thumbnailUrl: z.string().max(2048).nullable(),
  channelHandle: z.string().max(200).nullable(),
  channelSubscriberCount: z.number().int().nonnegative().nullable(),
  channelVideoCount: z.number().int().nonnegative().nullable(),
  channelViewCount: z.number().int().nonnegative().nullable(),
  channelCountry: z.string().max(10).nullable(),
  channelPublishedAt: Timestamp.nullable(),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;
export type MetadataField = keyof VideoMetadata;
export const METADATA_FIELDS = Object.keys(
  VideoMetadataSchema.shape,
) as MetadataField[];

export const EMPTY_METADATA: VideoMetadata = Object.fromEntries(
  METADATA_FIELDS.map((field) => [field, null]),
) as VideoMetadata;

export const METADATA_FIELD_LABELS: Record<MetadataField, string> = {
  title: "Title",
  description: "Description",
  publishedAt: "Published",
  durationSeconds: "Duration",
  channelId: "Channel id",
  channelTitle: "Channel",
  viewCount: "Views",
  likeCount: "Likes",
  commentCount: "Comments",
  tags: "Tags",
  categoryId: "Category id",
  defaultLanguage: "Metadata language",
  defaultAudioLanguage: "Audio language",
  captionsAvailable: "Captions",
  definition: "Definition",
  liveBroadcastContent: "Live status",
  madeForKids: "Made for kids",
  topicCategories: "Topic categories",
  thumbnailUrl: "Thumbnail",
  channelHandle: "Channel handle",
  channelSubscriberCount: "Subscribers",
  channelVideoCount: "Channel videos",
  channelViewCount: "Channel views",
  channelCountry: "Channel country",
  channelPublishedAt: "Channel created",
};

/**
 * Why a field has no value, or what to know about the value it has.
 * - hidden: the owner chose not to show it publicly
 * - not-provided: the source returned nothing for it
 * - not-applicable: it does not apply to this video (a live stream's duration)
 * - available: it has a value; the note qualifies it (a rounded count)
 */
export const FIELD_STATES = [
  "available",
  "hidden",
  "not-provided",
  "not-applicable",
] as const;
export const FieldNoteSchema = z.object({
  state: z.enum(FIELD_STATES),
  note: z.string().max(500).nullable(),
});
export type FieldNote = z.infer<typeof FieldNoteSchema>;

export const METADATA_SOURCES = ["youtube-data-api", "manual"] as const;

export const MetadataSnapshotSchema = z.object({
  id: IdSchema,
  referenceVideoId: IdSchema,
  source: z.enum(METADATA_SOURCES),
  retrievedAt: Timestamp,
  metadata: VideoMetadataSchema,
  fields: z.partialRecord(z.enum(METADATA_FIELDS), FieldNoteSchema),
  /** The API calls made, for the record. Empty for manual entries. */
  requests: z.array(z.string()),
  quotaUnits: z.number().int().nonnegative(),
});
export type MetadataSnapshot = z.infer<typeof MetadataSnapshotSchema>;

/** What a user can enter by hand when the API is not available. */
export const ManualMetadataSchema = z.strictObject({
  title: z.string().trim().max(500).nullable().default(null),
  channelTitle: z.string().trim().max(500).nullable().default(null),
  publishedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
    .nullable()
    .default(null),
  durationSeconds: z
    .number()
    .positive()
    .max(1_000_000)
    .nullable()
    .default(null),
  viewCount: z.number().int().nonnegative().nullable().default(null),
  likeCount: z.number().int().nonnegative().nullable().default(null),
  commentCount: z.number().int().nonnegative().nullable().default(null),
  defaultAudioLanguage: z.string().trim().max(35).nullable().default(null),
  description: z.string().max(10_000).nullable().default(null),
});
export type ManualMetadata = z.input<typeof ManualMetadataSchema>;

// ---------------------------------------------------------- reference videos

export const ReferenceVideoSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  platform: z.literal("youtube"),
  videoId: z.string().regex(VIDEO_ID),
  url: z.string(),
  notes: z.string().max(10_000),
  addedAt: Timestamp,
});
export type ReferenceVideo = z.infer<typeof ReferenceVideoSchema>;

export const ReferenceVideoSummarySchema = ReferenceVideoSchema.extend({
  title: z.string().nullable(),
  channelTitle: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  metadataSource: z.enum(METADATA_SOURCES).nullable(),
  metadataRetrievedAt: Timestamp.nullable(),
  storedComments: z.number().int().nonnegative(),
  transcripts: z.number().int().nonnegative(),
});
export type ReferenceVideoSummary = z.infer<typeof ReferenceVideoSummarySchema>;

// ---------------------------------------------------------------- comments

export const COMMENT_ORDERS = ["relevance", "time"] as const;
export const CommentOrderSchema = z.enum(COMMENT_ORDERS);
export type CommentOrder = z.infer<typeof CommentOrderSchema>;

export const CommentSampleSchema = z.object({
  id: IdSchema,
  referenceVideoId: IdSchema,
  source: z.literal("youtube-data-api"),
  /** YouTube's own order: "relevance" is its ranking, not a random sample. */
  order: CommentOrderSchema,
  status: z.enum(["more-available", "complete", "comments-disabled"]),
  pagesFetched: z.number().int().nonnegative(),
  storedCount: z.number().int().nonnegative(),
  /** The video's public comment count when the last page was fetched. */
  reportedTotal: z.number().int().nonnegative().nullable(),
  startedAt: Timestamp,
  updatedAt: Timestamp,
});
export type CommentSample = z.infer<typeof CommentSampleSchema>;

/**
 * A top-level public comment. Authors' names and channels are not stored:
 * research needs what was said, not who said it.
 */
export const CommentSchema = z.object({
  id: IdSchema,
  sampleId: IdSchema,
  /** YouTube's id for the comment, so it can be found again. */
  commentId: z.string(),
  text: z.string(),
  likeCount: z.number().int().nonnegative().nullable(),
  replyCount: z.number().int().nonnegative().nullable(),
  publishedAt: Timestamp.nullable(),
  position: z.number().int().nonnegative(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CommentPageSchema = z.object({
  comments: z.array(CommentSchema),
  total: z.number().int().nonnegative(),
});
export type CommentPage = z.infer<typeof CommentPageSchema>;

// -------------------------------------------------------------- transcripts

export const TRANSCRIPT_FORMATS = ["webvtt", "srt", "text"] as const;
export const TranscriptFormatSchema = z.enum(TRANSCRIPT_FORMATS);
export type TranscriptFormat = z.infer<typeof TranscriptFormatSchema>;

/** The user's statement of why they may use a transcript. */
export const RIGHTS_BASES = [
  "own-content",
  "licensed",
  "permission",
  "open-licence",
] as const;
export const RightsBasisSchema = z.enum(RIGHTS_BASES);
export type RightsBasis = z.infer<typeof RightsBasisSchema>;

export const RIGHTS_BASIS_LABELS: Record<RightsBasis, string> = {
  "own-content": "It is my own video or my own transcript",
  licensed: "I have a licence to use it",
  permission: "The rights holder gave me permission",
  "open-licence": "It is published under an open licence",
};

export const TRANSCRIPT_MAX_BYTES = 5 * 1024 * 1024;

export const TranscriptSchema = z.object({
  id: IdSchema,
  referenceVideoId: IdSchema,
  source: z.literal("transcript-file"),
  fileName: z.string(),
  format: TranscriptFormatSchema,
  /** As declared by the user at import; never detected or guessed. */
  language: z.string().nullable(),
  rightsBasis: RightsBasisSchema,
  rightsNote: z.string(),
  importedAt: Timestamp,
  segmentCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  hasTimestamps: z.boolean(),
  /** From the first segment's start to the last one's end, when timed. */
  coveredSeconds: z.number().nonnegative().nullable(),
  warnings: z.array(z.string()),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const TranscriptSegmentSchema = z.object({
  id: IdSchema,
  transcriptId: IdSchema,
  position: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptDetailSchema = z.object({
  transcript: TranscriptSchema,
  segments: z.array(TranscriptSegmentSchema),
});
export type TranscriptDetail = z.infer<typeof TranscriptDetailSchema>;

export const TranscriptImportSchema = z.strictObject({
  referenceVideoId: IdSchema,
  fileName: z.string().trim().min(1).max(255),
  /** The file's text. The interface reads the file the user picked. */
  content: z.string().max(TRANSCRIPT_MAX_BYTES),
  /** Detected from the content and file name when null. */
  format: TranscriptFormatSchema.nullable().default(null),
  language: z.string().trim().max(35).nullable().default(null),
  rightsBasis: RightsBasisSchema,
  rightsNote: z.string().trim().max(1000).default(""),
  /** Records that the user confirmed they may use this transcript. */
  authorized: z.literal(true),
});
export type TranscriptImport = z.input<typeof TranscriptImportSchema>;

// ----------------------------------------------------- findings and evidence

export const FINDING_KINDS = [
  "video-facts",
  "language",
  "transcript-length",
  "transcript-structure",
  "comment-topic",
  "comment-questions",
  "comment-moments",
  "note",
] as const;
export const FindingKindSchema = z.enum(FINDING_KINDS);
export type FindingKind = z.infer<typeof FindingKindSchema>;

/**
 * observed: true of the collected data, such as a count.
 * inferred: a conclusion drawn from it, which could be wrong.
 */
export const FINDING_BASES = ["observed", "inferred"] as const;
export const FindingBasisSchema = z.enum(FINDING_BASES);
export type FindingBasis = z.infer<typeof FindingBasisSchema>;

/** Who produced a finding. "local-model" is reserved for Phase 5A.2. */
export const FINDING_GENERATORS = [
  "framebop-rules",
  "user",
  "local-model",
] as const;
export type FindingGenerator = (typeof FINDING_GENERATORS)[number];

export const EVIDENCE_KINDS = [
  "metadata-snapshot",
  "comment-sample",
  "comment",
  "transcript",
  "transcript-segment",
] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceReferenceSchema = z.object({
  id: IdSchema,
  findingId: IdSchema,
  position: z.number().int().nonnegative(),
  kind: EvidenceKindSchema,
  /** The id of the snapshot, sample, comment, transcript or segment. */
  targetId: IdSchema,
  /** Where in the target: a field name or a time range. */
  locator: z.string().nullable(),
  /** A short quote, kept so the evidence stays readable if the source goes. */
  excerpt: z.string().nullable(),
  source: ResearchSourceSchema,
  retrievedAt: Timestamp,
  /** False once the source data has been deleted from the project. */
  available: z.boolean(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const ResearchFindingSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  referenceVideoId: IdSchema.nullable(),
  kind: FindingKindSchema,
  title: z.string(),
  statement: z.string(),
  basis: FindingBasisSchema,
  generator: z.enum(FINDING_GENERATORS),
  /** How the finding was produced, in plain words. */
  method: z.string(),
  /** What limits it: sample size, ordering, missing data. */
  uncertainty: z.string().nullable(),
  /**
   * How sure the producer is. Required for a model's inferred findings;
   * null for counts, and optional in the user's own notes.
   */
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  createdAt: Timestamp,
  evidence: z.array(EvidenceReferenceSchema),
});
export type ResearchFinding = z.infer<typeof ResearchFindingSchema>;

export const NoteCreateSchema = z.strictObject({
  projectId: IdSchema,
  referenceVideoId: IdSchema.nullable().default(null),
  title: z.string().trim().min(1, "A title is required").max(200),
  statement: z.string().trim().min(1, "Write the note").max(5000),
  basis: FindingBasisSchema,
  evidence: z
    .array(z.strictObject({ kind: EvidenceKindSchema, targetId: IdSchema }))
    .max(50)
    .default([]),
});
export type NoteCreate = z.input<typeof NoteCreateSchema>;

// ---------------------------------------------------------------- coverage

export const COVERAGE_STATES = [
  "collected",
  "partial",
  "missing",
  "hidden",
] as const;

export const CoverageItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  state: z.enum(COVERAGE_STATES),
  detail: z.string(),
  source: ResearchSourceSchema.nullable(),
  retrievedAt: Timestamp.nullable(),
  /** API data older than YouTube allows it to be kept without a refresh. */
  needsRefresh: z.boolean(),
});
export type CoverageItem = z.infer<typeof CoverageItemSchema>;

export const CoverageReportSchema = z.object({
  items: z.array(CoverageItemSchema),
  /** Data no public API offers for someone else's video. */
  unavailable: z.array(z.object({ label: z.string(), reason: z.string() })),
});
export type CoverageReport = z.infer<typeof CoverageReportSchema>;

export const ReferenceVideoDetailSchema = z.object({
  video: ReferenceVideoSchema,
  snapshot: MetadataSnapshotSchema.nullable(),
  snapshots: z.array(
    MetadataSnapshotSchema.pick({
      id: true,
      source: true,
      retrievedAt: true,
    }),
  ),
  commentSample: CommentSampleSchema.nullable(),
  transcripts: z.array(TranscriptSchema),
  findings: z.array(ResearchFindingSchema),
  coverage: CoverageReportSchema,
});
export type ReferenceVideoDetail = z.infer<typeof ReferenceVideoDetailSchema>;

export const ResearchProjectDetailSchema = z.object({
  project: ResearchProjectSchema,
  videos: z.array(ReferenceVideoSummarySchema),
  /** Notes about the project as a whole, not one video. */
  notes: z.array(ResearchFindingSchema),
});
export type ResearchProjectDetail = z.infer<typeof ResearchProjectDetailSchema>;

// ------------------------------------------------------------- credentials

export const YouTubeKeyStatusSchema = z.object({
  configured: z.boolean(),
  /** Where the key in use comes from. */
  source: z.enum(["secure-storage", "session", "environment"]).nullable(),
  /** The operating system's secure storage, when this platform has one. */
  secureStorage: z.string().nullable(),
  /** What to know about how the key is kept. */
  note: z.string(),
});
export type YouTubeKeyStatus = z.infer<typeof YouTubeKeyStatusSchema>;

/** Google API keys are 39 characters; this accepts a little more. */
export const YouTubeApiKeySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]{30,100}$/,
    "That does not look like a Google API key.",
  );

/** Why a YouTube request failed, carried in an error's `details.reason`. */
export const YOUTUBE_FAILURES = [
  "key-missing",
  "key-invalid",
  "key-restricted",
  "api-disabled",
  "quota-exceeded",
  "rate-limited",
  "forbidden",
  "not-found",
  "offline",
  "server-error",
  "bad-response",
] as const;
export type YouTubeFailure = (typeof YOUTUBE_FAILURES)[number];

export function youTubeFailureOf(details: unknown): YouTubeFailure | null {
  if (typeof details !== "object" || details === null) return null;
  const { service, reason } = details as Record<string, unknown>;
  return service === "youtube" &&
    (YOUTUBE_FAILURES as readonly unknown[]).includes(reason)
    ? (reason as YouTubeFailure)
    : null;
}

// ------------------------------------------------------- planned analysis

/** Analyses by the local language model (Phase 5A.2). */
export const ANALYSIS_TASKS = [
  "hooks",
  "narrative",
  "pacing",
  "audience",
  "concepts",
  "language",
] as const;
export const AnalysisTaskSchema = z.enum(ANALYSIS_TASKS);
export type AnalysisTask = (typeof ANALYSIS_TASKS)[number];

export const AnalysisCapabilitySchema = z.object({
  task: z.enum(ANALYSIS_TASKS),
  label: z.string(),
  description: z.string(),
  available: z.boolean(),
  reason: z.string(),
});
export type AnalysisCapability = z.infer<typeof AnalysisCapabilitySchema>;

// ---------------------------------------------------------- AI analyses

/**
 * observation    - what the material directly shows, as read by the model
 * interpretation - the model's reading of it
 * hypothesis     - an unverified guess, such as about a market
 * concept        - an original idea for a new video
 */
export const ANALYSIS_ITEM_KINDS = [
  "observation",
  "interpretation",
  "hypothesis",
  "concept",
] as const;

/** Evidence as stored with an analysis item: resolved, quoted from storage. */
export const AnalysisEvidenceSchema = z.object({
  kind: EvidenceKindSchema,
  targetId: IdSchema,
  locator: z.string().nullable(),
  excerpt: z.string().nullable(),
  source: ResearchSourceSchema,
  retrievedAt: Timestamp,
});
export type AnalysisEvidence = z.infer<typeof AnalysisEvidenceSchema>;

export const AnalysisItemSchema = z.object({
  id: z.string(),
  kind: z.enum(ANALYSIS_ITEM_KINDS),
  /** "model" for the language model, "rules" for Framebop's own measurement. */
  source: z.enum(["model", "rules"]),
  title: z.string(),
  statement: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  /** Task-specific fields, such as a concept's premise or a comment's signal. */
  details: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.array(z.string())]),
  ),
  evidence: z.array(AnalysisEvidenceSchema),
});
export type AnalysisItem = z.infer<typeof AnalysisItemSchema>;

export const AnalysisSectionSchema = z.object({
  task: AnalysisTaskSchema,
  status: z.enum(["completed", "skipped", "failed"]),
  /** Why it was skipped or failed, or what its input lacked. */
  reason: z.string().nullable(),
  /** What the model was given, in words. */
  input: z.string(),
  items: z.array(AnalysisItemSchema),
  /** Items the model produced that failed validation, and why. */
  rejected: z.array(
    z.object({ title: z.string(), problems: z.array(z.string()) }),
  ),
  durationMs: z.number().nullable(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
});
export type AnalysisSection = z.infer<typeof AnalysisSectionSchema>;

export const ANALYSIS_STATUSES = [
  "queued",
  "loading-model",
  "analyzing",
  "validating",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ResearchAnalysisSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  referenceVideoId: IdSchema,
  jobId: IdSchema.nullable(),
  status: z.enum(ANALYSIS_STATUSES),
  modelId: z.string(),
  modelName: z.string(),
  /** The runtime as it reported itself, e.g. "llama.cpp 0.6.0-dev (build 11641, …)". */
  runtime: z.string().nullable(),
  config: z.object({
    tasks: z.array(AnalysisTaskSchema),
    contextTokens: z.number().int(),
    maxTokens: z.number().int(),
    temperature: z.number(),
  }),
  /** Identifies the research data the analysis read. */
  inputFingerprint: z.string(),
  /** True when that data has changed since. */
  stale: z.boolean(),
  sections: z.array(AnalysisSectionSchema),
  error: z.string().nullable(),
  createdAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
export type ResearchAnalysis = z.infer<typeof ResearchAnalysisSchema>;

/** A language model the analysis can use, with what is known about it. */
export const LocalModelOptionSchema = z.object({
  modelId: z.string(),
  name: z.string(),
  quantization: z.string().nullable(),
  sizeBytes: z.number().int(),
  provider: z.string(),
  license: z.string(),
  /** "installed", "downloading", "not-installed", or "external" for read-only copies. */
  installation: z.enum([
    "installed",
    "downloading",
    "not-installed",
    "external",
  ]),
  path: z.string().nullable(),
  /** The file's own description, when it could be read. */
  file: z
    .object({
      architecture: z.string().nullable(),
      layers: z.number().nullable(),
      trainedContextTokens: z.number().nullable(),
    })
    .nullable(),
  /** Why the file can or cannot be used, from reading it. */
  compatibility: z.object({ ok: z.boolean(), reason: z.string() }),
  /** Weights plus the key and value cache, from the file's metadata. */
  estimatedMemoryBytes: z.number().nullable(),
  contextTokens: z.number().int(),
  /** The last real test run with the current runtime, if any. */
  inferenceCheck: z
    .object({
      ok: z.boolean(),
      runtime: z.string(),
      checkedAt: Timestamp,
      detail: z.string(),
    })
    .nullable(),
});
export type LocalModelOption = z.infer<typeof LocalModelOptionSchema>;

export const LocalLlmStatusSchema = z.object({
  /** The configured llama-server, and what it reported. */
  runtime: z.object({
    path: z.string().nullable(),
    version: z.string().nullable(),
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
  state: z.enum(["unavailable", "idle", "loading", "ready", "busy"]),
  detail: z.string(),
  loadedModelId: z.string().nullable(),
  /** Measured resident memory of the runtime process, when loaded. */
  residentBytes: z.number().nullable(),
  /** The memory budget for language models on this computer. */
  budgetBytes: z.number().nullable(),
  models: z.array(LocalModelOptionSchema),
});
export type LocalLlmStatus = z.infer<typeof LocalLlmStatusSchema>;

// -------------------------------------------- hand-off to production (5A.3)

/** An original concept from an analysis, as Phase 5A.3 will receive it. */
export interface ConceptHandoff {
  analysisId: string;
  itemId: string;
  title: string;
  premise: string;
  angle: string;
  audience: string;
  durationMinutes: number | null;
  visualDirection: string;
  researchNeeded: string[];
  evidence: AnalysisEvidence[];
}

export function conceptHandoff(
  analysisId: string,
  item: AnalysisItem,
): ConceptHandoff | null {
  if (item.kind !== "concept") return null;
  const text = (key: string) =>
    typeof item.details[key] === "string" ? (item.details[key] as string) : "";
  const duration = item.details.durationMinutes;
  const research = item.details.researchNeeded;
  return {
    analysisId,
    itemId: item.id,
    title: item.title,
    premise: text("premise"),
    angle: text("angle"),
    audience: text("audience"),
    durationMinutes: typeof duration === "number" ? duration : null,
    visualDirection: text("visualDirection"),
    researchNeeded: Array.isArray(research) ? research : [],
    evidence: item.evidence,
  };
}
