/**
 * Transparent, rule-based analysis of collected research data.
 *
 * Every function here is deterministic and explainable in one sentence,
 * which each finding carries as its `method`. Nothing is inferred: findings
 * report what is in the collected data, with the evidence they rest on and
 * the limits of that data. No language model or other AI is involved.
 */
import {
  type CommentSample,
  type CoverageItem,
  type CoverageReport,
  type EvidenceKind,
  type FindingBasis,
  type FindingKind,
  type MetadataField,
  type MetadataSnapshot,
  METADATA_FIELD_LABELS,
  type ResearchSource,
  type Transcript,
  YOUTUBE_DATA_MAX_AGE_DAYS,
  formatClock,
  isOlderThanDays,
} from "@framebop/core";
import { IGNORED_WORDS } from "./stopwords";
import { countWords } from "./transcript";

export interface CommentInput {
  id: string;
  text: string;
  likeCount: number | null;
  publishedAt: string | null;
}

export interface SegmentInput {
  id: string;
  startMs: number | null;
  endMs: number | null;
  text: string;
}

export interface EvidenceDraft {
  kind: EvidenceKind;
  targetId: string;
  locator: string | null;
  excerpt: string | null;
  source: ResearchSource;
  retrievedAt: string;
}

export interface FindingDraft {
  kind: FindingKind;
  title: string;
  statement: string;
  basis: FindingBasis;
  method: string;
  uncertainty: string | null;
  confidence: "low" | "medium" | "high" | null;
  evidence: EvidenceDraft[];
}

const EXCERPT_CHARS = 280;
const EVIDENCE_PER_FINDING = 5;

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS
    ? `${flat.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`
    : flat;
}

const number = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
const plural = (count: number, one: string, many = `${one}s`) =>
  `${number(count)} ${count === 1 ? one : many}`;

function timeRange(
  startMs: number | null,
  endMs: number | null,
): string | null {
  if (startMs === null) return null;
  const start = formatClock(startMs / 1000);
  return endMs === null ? start : `${start}–${formatClock(endMs / 1000)}`;
}

// ------------------------------------------------------------ comment topics

/** Lower-cased words of a comment, without links, mentions and times. */
export function topicWords(text: string): Set<string> {
  const cleaned = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/̇/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\S+/g, " ")
    .replace(/\d{1,2}(?::\d{2}){1,2}/g, " ");
  const words = new Set<string>();
  for (const match of cleaned.matchAll(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)) {
    // "creator's" and Turkish "video'yu" are read as "creator" and "video".
    const word = match[0].split(/['’]/)[0]?.replace(/-+$/, "") ?? "";
    if (word.length < 3 || IGNORED_WORDS.has(word)) continue;
    words.add(word);
  }
  return words;
}

export interface TopicGroup {
  word: string;
  /** Other words often found in the same comments. */
  related: string[];
  /** Most liked first. */
  commentIds: string[];
}

export interface TopicGrouping {
  groups: TopicGroup[];
  total: number;
  grouped: number;
  /** A word must be in at least this many comments to form a group. */
  minimum: number;
}

const byLikes = (a: CommentInput, b: CommentInput) =>
  (b.likeCount ?? 0) - (a.likeCount ?? 0);

/**
 * Groups comments by the most common words they share. Words are ranked by
 * how many comments contain them; each comment joins the first group whose
 * word it contains. Different forms of a word count separately.
 */
export function groupCommentTopics(
  comments: readonly CommentInput[],
  maxGroups = 6,
): TopicGrouping {
  const words = comments.map((comment) => topicWords(comment.text));
  const frequency = new Map<string, number>();
  for (const set of words) {
    for (const word of set) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  const minimum = Math.max(2, Math.ceil(comments.length * 0.01));
  const candidates = [...frequency]
    .filter(([, count]) => count >= minimum)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));

  const assigned = new Set<number>();
  const groups: TopicGroup[] = [];
  for (const [word] of candidates) {
    if (groups.length >= maxGroups) break;
    const members = comments
      .map((_, index) => index)
      .filter((index) => !assigned.has(index) && words[index]?.has(word));
    if (members.length < minimum) continue;
    for (const index of members) assigned.add(index);

    const companions = new Map<string, number>();
    for (const index of members) {
      for (const other of words[index] ?? []) {
        if (other !== word)
          companions.set(other, (companions.get(other) ?? 0) + 1);
      }
    }
    groups.push({
      word,
      related: [...companions]
        .filter(([, count]) => count >= 2)
        .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
        .slice(0, 4)
        .map(([other]) => other),
      commentIds: members
        .map((index) => comments[index] as CommentInput)
        .sort(byLikes)
        .map((comment) => comment.id),
    });
  }
  return { groups, total: comments.length, grouped: assigned.size, minimum };
}

export function questionComments(
  comments: readonly CommentInput[],
): CommentInput[] {
  return comments.filter((comment) => /[?？¿]/.test(comment.text));
}

const COMMENT_TIME = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)(?![\d:])/g;

/** Times written in a comment ("at 4:12"), in seconds. */
export function mentionedTimes(text: string): number[] {
  const times: number[] = [];
  for (const match of text.matchAll(COMMENT_TIME)) {
    const [, hours, minutes, seconds] = match;
    if (hours !== undefined && Number(minutes) > 59) continue;
    times.push(
      Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds),
    );
  }
  return times;
}

export interface MomentBucket {
  startSeconds: number;
  endSeconds: number;
  commentIds: string[];
}

export const MOMENT_WINDOW_SECONDS = 30;

/** Counts comments per 30-second window of the times they mention. */
export function commentMoments(
  comments: readonly CommentInput[],
  durationSeconds: number | null,
): { buckets: MomentBucket[]; mentioning: number } {
  const buckets = new Map<number, CommentInput[]>();
  let mentioning = 0;
  for (const comment of comments) {
    const windows = new Set(
      mentionedTimes(comment.text)
        .filter((time) => durationSeconds === null || time <= durationSeconds)
        .map((time) => Math.floor(time / MOMENT_WINDOW_SECONDS)),
    );
    if (windows.size > 0) mentioning += 1;
    for (const window of windows) {
      buckets.set(window, [...(buckets.get(window) ?? []), comment]);
    }
  }
  return {
    mentioning,
    buckets: [...buckets]
      .filter(([, members]) => members.length >= 2)
      .sort(([a, x], [b, y]) => y.length - x.length || a - b)
      .map(([window, members]) => ({
        startSeconds: window * MOMENT_WINDOW_SECONDS,
        endSeconds: (window + 1) * MOMENT_WINDOW_SECONDS,
        commentIds: [...members].sort(byLikes).map((comment) => comment.id),
      })),
  };
}

// --------------------------------------------------------- transcript timing

export interface TranscriptStructure {
  words: number;
  spanMs: number;
  wordsPerMinute: number | null;
  opening: {
    words: number;
    segmentIds: string[];
    wordsPerMinute: number | null;
  };
  quarters: {
    startMs: number;
    endMs: number;
    words: number;
    wordsPerMinute: number | null;
  }[];
  pauses: {
    afterSegmentId: string;
    beforeSegmentId: string;
    startMs: number;
    lengthMs: number;
  }[];
}

export const OPENING_MS = 30_000;
export const PAUSE_MS = 2000;

const rate = (words: number, ms: number) =>
  ms >= 1000 ? Math.round(words / (ms / 60_000)) : null;

/** Speaking rate overall, in the opening and by quarter, and long pauses. */
export function transcriptStructure(
  segments: readonly SegmentInput[],
): TranscriptStructure | null {
  const timed = segments.filter(
    (segment): segment is SegmentInput & { startMs: number } =>
      segment.startMs !== null,
  );
  if (timed.length === 0) return null;
  const start = Math.min(...timed.map((segment) => segment.startMs));
  const end = Math.max(
    ...timed.map((segment) => segment.endMs ?? segment.startMs),
  );
  const spanMs = end - start;
  const words = timed.reduce(
    (total, segment) => total + countWords(segment.text),
    0,
  );

  const openingEnd = start + OPENING_MS;
  const opening = timed.filter((segment) => segment.startMs < openingEnd);
  const openingWords = opening.reduce(
    (total, segment) => total + countWords(segment.text),
    0,
  );

  const quarterMs = spanMs / 4;
  const quarters =
    quarterMs > 0
      ? [0, 1, 2, 3].map((index) => {
          const from = start + index * quarterMs;
          const to = index === 3 ? end : from + quarterMs;
          const inside = timed.filter(
            (segment) =>
              segment.startMs >= from &&
              (index === 3 ? segment.startMs <= to : segment.startMs < to),
          );
          const count = inside.reduce(
            (total, segment) => total + countWords(segment.text),
            0,
          );
          return {
            startMs: Math.round(from),
            endMs: Math.round(to),
            words: count,
            wordsPerMinute: rate(count, to - from),
          };
        })
      : [];

  const pauses: TranscriptStructure["pauses"] = [];
  for (let index = 1; index < timed.length; index += 1) {
    const before = timed[index - 1];
    const after = timed[index];
    if (!before || !after || before.endMs === null) continue;
    const gap = after.startMs - before.endMs;
    if (gap >= PAUSE_MS) {
      pauses.push({
        afterSegmentId: before.id,
        beforeSegmentId: after.id,
        startMs: before.endMs,
        lengthMs: gap,
      });
    }
  }
  pauses.sort((a, b) => b.lengthMs - a.lengthMs || a.startMs - b.startMs);

  return {
    words,
    spanMs,
    wordsPerMinute: rate(words, spanMs),
    opening: {
      words: openingWords,
      segmentIds: opening.map((segment) => segment.id),
      wordsPerMinute: rate(openingWords, Math.min(OPENING_MS, spanMs)),
    },
    quarters,
    pauses: pauses.slice(0, 3),
  };
}

// ---------------------------------------------------------- rule findings

export interface RuleInput {
  snapshot: MetadataSnapshot | null;
  sample: CommentSample | null;
  comments: readonly CommentInput[];
  transcripts: readonly {
    transcript: Transcript;
    segments: readonly SegmentInput[];
  }[];
}

const METHODS = {
  facts: "Copied from the latest metadata snapshot.",
  language:
    "Copied from the metadata snapshot and from the language declared when each transcript was imported. Nothing is detected automatically.",
  length:
    "Counted from the imported transcript. Words are runs of letters or digits, so for languages written without spaces, such as Chinese or Japanese, the word count is not meaningful.",
  structure: `Measured from the transcript's timestamps: words per minute over the whole transcript, its first ${OPENING_MS / 1000} seconds and each quarter of its length, and gaps of ${PAUSE_MS / 1000} seconds or more between segments.`,
  topics:
    'Comments were grouped by the most common words they share, after removing common words and generic reactions such as "great" or "thanks". A comment joins the first group whose word it contains. Different forms of a word count separately. No AI was used.',
  questions: "Counted the retrieved comments that contain a question mark.",
  moments: `Found times written in comments (such as 4:12) and counted the comments in each ${MOMENT_WINDOW_SECONDS}-second window.`,
};

function snapshotEvidence(
  snapshot: MetadataSnapshot,
  field: MetadataField,
  value: string,
): EvidenceDraft {
  return {
    kind: "metadata-snapshot",
    targetId: snapshot.id,
    locator: field,
    excerpt: `${METADATA_FIELD_LABELS[field]}: ${value}`,
    source: snapshot.source,
    retrievedAt: snapshot.retrievedAt,
  };
}

function snapshotFacts(snapshot: MetadataSnapshot): FindingDraft | null {
  const m = snapshot.metadata;
  const facts: [MetadataField, string][] = [];
  if (m.durationSeconds !== null)
    facts.push(["durationSeconds", formatClock(m.durationSeconds)]);
  if (m.publishedAt !== null)
    facts.push(["publishedAt", m.publishedAt.slice(0, 10)]);
  if (m.viewCount !== null) facts.push(["viewCount", number(m.viewCount)]);
  if (m.likeCount !== null) facts.push(["likeCount", number(m.likeCount)]);
  if (m.commentCount !== null)
    facts.push(["commentCount", number(m.commentCount)]);
  if (m.channelSubscriberCount !== null) {
    facts.push(["channelSubscriberCount", number(m.channelSubscriberCount)]);
  }
  if (facts.length === 0) return null;

  const missing = (
    [
      "durationSeconds",
      "publishedAt",
      "viewCount",
      "likeCount",
      "commentCount",
    ] as const
  )
    .filter((field) => m[field] === null)
    .map((field) => METADATA_FIELD_LABELS[field].toLowerCase());
  const date = snapshot.retrievedAt.slice(0, 10);
  return {
    kind: "video-facts",
    title: "Video facts",
    statement: `${facts.map(([field, value]) => `${METADATA_FIELD_LABELS[field]}: ${value}`).join(". ")}.${missing.length > 0 ? ` Not known: ${missing.join(", ")}.` : ""}`,
    basis: "observed",
    method: METHODS.facts,
    uncertainty:
      snapshot.source === "manual"
        ? `Entered by you on ${date}; not checked against YouTube.`
        : `Public counts change over time; these are as of ${date}.`,
    confidence: null,
    evidence: facts.map(([field, value]) =>
      snapshotEvidence(snapshot, field, value),
    ),
  };
}

function languageFacts(input: RuleInput): FindingDraft | null {
  const { snapshot, transcripts } = input;
  if (!snapshot && transcripts.length === 0) return null;
  const parts: string[] = [];
  const evidence: EvidenceDraft[] = [];
  if (snapshot) {
    const m = snapshot.metadata;
    const declared = (field: MetadataField, label: string) => {
      const value = m[field];
      if (typeof value === "string") {
        parts.push(`${label}: ${value} (set by the uploader)`);
        evidence.push(snapshotEvidence(snapshot, field, value));
      } else {
        parts.push(`${label}: not set`);
      }
    };
    declared("defaultAudioLanguage", "Audio language");
    declared("defaultLanguage", "Title and description language");
    if (m.captionsAvailable !== null) {
      parts.push(
        m.captionsAvailable
          ? "Captions: the video has captions (their text is not retrievable)"
          : "Captions: none, per the API",
      );
      evidence.push(
        snapshotEvidence(
          snapshot,
          "captionsAvailable",
          m.captionsAvailable ? "yes" : "no",
        ),
      );
    }
  }
  for (const { transcript } of transcripts) {
    parts.push(
      `Transcript "${transcript.fileName}": ${transcript.language ? `${transcript.language} (declared at import)` : "language not declared"}`,
    );
    evidence.push({
      kind: "transcript",
      targetId: transcript.id,
      locator: null,
      excerpt: transcript.fileName,
      source: "transcript-file",
      retrievedAt: transcript.importedAt,
    });
  }
  if (evidence.length === 0) return null;
  return {
    kind: "language",
    title: "Language information",
    statement: `${parts.join(". ")}.`,
    basis: "observed",
    method: METHODS.language,
    uncertainty:
      "Uploaders often leave the language fields unset or set them incorrectly.",
    confidence: null,
    evidence,
  };
}

function transcriptFindings(
  transcript: Transcript,
  segments: readonly SegmentInput[],
  durationSeconds: number | null,
): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const transcriptEvidence: EvidenceDraft = {
    kind: "transcript",
    targetId: transcript.id,
    locator: null,
    excerpt: transcript.fileName,
    source: "transcript-file",
    retrievedAt: transcript.importedAt,
  };
  const covered = transcript.coveredSeconds;
  let coverage =
    "It has no timestamps, so how much of the video it covers is unknown.";
  if (covered !== null) {
    coverage =
      durationSeconds !== null && durationSeconds > 0
        ? `It spans ${formatClock(covered)} of the video's ${formatClock(durationSeconds)} (${percent(Math.min(covered, durationSeconds), durationSeconds)}).`
        : `It spans ${formatClock(covered)}; the video's duration is not known.`;
  }
  findings.push({
    kind: "transcript-length",
    title: `Transcript length: ${transcript.fileName}`,
    statement: `${plural(transcript.wordCount, "word")} in ${plural(transcript.segmentCount, "segment")}. ${coverage}`,
    basis: "observed",
    method: METHODS.length,
    uncertainty: null,
    confidence: null,
    evidence: [transcriptEvidence],
  });

  const structure = transcript.hasTimestamps
    ? transcriptStructure(segments)
    : null;
  if (structure && structure.spanMs > 0) {
    const sentences: string[] = [];
    if (structure.wordsPerMinute !== null) {
      sentences.push(
        `Overall about ${number(structure.wordsPerMinute)} words per minute.`,
      );
    }
    sentences.push(
      `First ${OPENING_MS / 1000} seconds: ${plural(structure.opening.words, "word")}${structure.opening.wordsPerMinute !== null ? ` (about ${number(structure.opening.wordsPerMinute)} per minute)` : ""}.`,
    );
    if (structure.quarters.length === 4) {
      sentences.push(
        `Words by quarter of the transcript: ${structure.quarters.map((quarter) => number(quarter.words)).join(" / ")}.`,
      );
    }
    sentences.push(
      structure.pauses.length > 0
        ? `Longest pauses: ${structure.pauses.map((pause) => `${(pause.lengthMs / 1000).toFixed(1)} s at ${formatClock(pause.startMs / 1000)}`).join(", ")}.`
        : `No pauses of ${PAUSE_MS / 1000} seconds or more between segments.`,
    );
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    const segmentEvidence = (id: string): EvidenceDraft | null => {
      const segment = byId.get(id);
      return segment
        ? {
            kind: "transcript-segment",
            targetId: segment.id,
            locator: timeRange(segment.startMs, segment.endMs),
            excerpt: excerpt(segment.text),
            source: "transcript-file",
            retrievedAt: transcript.importedAt,
          }
        : null;
    };
    const cited = [
      ...structure.opening.segmentIds.slice(0, 3),
      ...structure.pauses.flatMap((pause) => [pause.afterSegmentId]),
    ];
    findings.push({
      kind: "transcript-structure",
      title: `Timing: ${transcript.fileName}`,
      statement: sentences.join(" "),
      basis: "observed",
      method: METHODS.structure,
      uncertainty:
        transcript.format === "text"
          ? "This file gives only start times, so each line is taken to last until the next; speaking rates and pauses are approximate."
          : "Rates depend on how the transcript was timed; captions are often shifted slightly from the speech.",
      confidence: null,
      evidence: [
        transcriptEvidence,
        ...[...new Set(cited)]
          .map(segmentEvidence)
          .filter((item): item is EvidenceDraft => item !== null),
      ],
    });
  }
  return findings;
}

function sampleScope(sample: CommentSample): string {
  const reported =
    sample.reportedTotal !== null && sample.reportedTotal > 0
      ? ` of ${number(sample.reportedTotal)} public comments (${percent(sample.storedCount, sample.reportedTotal)})`
      : "";
  const order =
    sample.order === "relevance"
      ? "in YouTube's relevance order, so not a random sample"
      : "newest first, so not a random sample";
  return `${plural(sample.storedCount, "comment")}${reported}, retrieved ${order}. Replies are not included, though the video's public comment count may include them.`;
}

function commentFindings(
  sample: CommentSample,
  comments: readonly CommentInput[],
  durationSeconds: number | null,
  transcripts: RuleInput["transcripts"],
): FindingDraft[] {
  if (comments.length === 0) return [];
  const findings: FindingDraft[] = [];
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const commentEvidence = (ids: readonly string[]): EvidenceDraft[] =>
    ids.slice(0, EVIDENCE_PER_FINDING).flatMap((id) => {
      const comment = byId.get(id);
      return comment
        ? [
            {
              kind: "comment" as const,
              targetId: comment.id,
              locator:
                comment.likeCount !== null
                  ? `${plural(comment.likeCount, "like")}`
                  : null,
              excerpt: excerpt(comment.text),
              source: "youtube-data-api" as const,
              retrievedAt: sample.updatedAt,
            },
          ]
        : [];
    });
  const scope = sampleScope(sample);
  const total = comments.length;

  const topics = groupCommentTopics(comments);
  for (const group of topics.groups) {
    findings.push({
      kind: "comment-topic",
      title: `Comments mentioning “${group.word}”`,
      statement: `${number(group.commentIds.length)} of ${plural(total, "retrieved comment")} (${percent(group.commentIds.length, total)}) contain “${group.word}”.${group.related.length > 0 ? ` Words often in the same comments: ${group.related.join(", ")}.` : ""}`,
      basis: "observed",
      method: METHODS.topics,
      uncertainty: scope,
      confidence: null,
      evidence: commentEvidence(group.commentIds),
    });
  }

  const questions = questionComments(comments);
  if (questions.length > 0) {
    findings.push({
      kind: "comment-questions",
      title: "Questions in the comments",
      statement: `${number(questions.length)} of ${plural(total, "retrieved comment")} (${percent(questions.length, total)}) contain a question mark.`,
      basis: "observed",
      method: METHODS.questions,
      uncertainty: scope,
      confidence: null,
      evidence: commentEvidence(
        [...questions].sort(byLikes).map((comment) => comment.id),
      ),
    });
  }

  const moments = commentMoments(comments, durationSeconds);
  const top = moments.buckets.slice(0, 3);
  if (top.length > 0) {
    const timed = transcripts.find(
      ({ transcript }) => transcript.hasTimestamps,
    );
    const first = top[0] as MomentBucket;
    const segmentEvidence: EvidenceDraft[] = timed
      ? timed.segments
          .filter(
            (segment) =>
              segment.startMs !== null &&
              segment.startMs < first.endSeconds * 1000 &&
              (segment.endMs ?? segment.startMs) >= first.startSeconds * 1000,
          )
          .slice(0, 3)
          .map((segment) => ({
            kind: "transcript-segment" as const,
            targetId: segment.id,
            locator: timeRange(segment.startMs, segment.endMs),
            excerpt: excerpt(segment.text),
            source: "transcript-file" as const,
            retrievedAt: timed.transcript.importedAt,
          }))
      : [];
    findings.push({
      kind: "comment-moments",
      title: "Moments comments point to",
      statement: `${number(moments.mentioning)} of ${plural(total, "retrieved comment")} mention a time in the video. Most often: ${top
        .map(
          (bucket) =>
            `${formatClock(bucket.startSeconds)}–${formatClock(bucket.endSeconds)} (${plural(bucket.commentIds.length, "comment")})`,
        )
        .join(
          ", ",
        )}.${segmentEvidence.length > 0 ? " The transcript's text for the first window is attached." : ""}`,
      basis: "observed",
      method: METHODS.moments,
      uncertainty: `${scope} A time in a comment usually, but not always, refers to this video.`,
      confidence: null,
      evidence: [...commentEvidence(first.commentIds), ...segmentEvidence],
    });
  }
  return findings;
}

/** Every rule-based finding the collected data supports, in display order. */
export function ruleFindings(input: RuleInput): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const durationSeconds = input.snapshot?.metadata.durationSeconds ?? null;
  if (input.snapshot) {
    const facts = snapshotFacts(input.snapshot);
    if (facts) findings.push(facts);
  }
  const language = languageFacts(input);
  if (language) findings.push(language);
  for (const { transcript, segments } of input.transcripts) {
    findings.push(...transcriptFindings(transcript, segments, durationSeconds));
  }
  if (input.sample && input.sample.status !== "comments-disabled") {
    findings.push(
      ...commentFindings(
        input.sample,
        input.comments,
        durationSeconds,
        input.transcripts,
      ),
    );
  }
  return findings;
}

// ---------------------------------------------------------------- coverage

/** What no public API offers about someone else's video. */
export const UNAVAILABLE_DATA: CoverageReport["unavailable"] = [
  {
    label: "Audience retention",
    reason:
      "Only the channel's owner sees it, in YouTube Analytics. No public API offers it for other channels.",
  },
  {
    label: "Viewer age, gender and location",
    reason: "Only the channel's owner sees it, in YouTube Analytics.",
  },
  {
    label: "Revenue and RPM",
    reason: "Only the channel's owner sees it, in YouTube Analytics.",
  },
  {
    label: "Impressions, click-through rate and traffic sources",
    reason: "Only the channel's owner sees them, in YouTube Analytics.",
  },
  {
    label: "Dislike count",
    reason:
      "Not public since December 2021; the API returns it only to the owner.",
  },
  {
    label: "Caption text",
    reason:
      "The API lets only the video's owner download captions. Import a transcript you may use instead.",
  },
];

export function coverageReport(input: {
  snapshot: MetadataSnapshot | null;
  sample: CommentSample | null;
  transcripts: readonly Transcript[];
  now?: Date;
}): CoverageReport {
  const now = input.now ?? new Date();
  const { snapshot, sample, transcripts } = input;
  const stale = (source: ResearchSource | null, at: string | null) =>
    source === "youtube-data-api" &&
    at !== null &&
    isOlderThanDays(at, YOUTUBE_DATA_MAX_AGE_DAYS, now);
  const items: CoverageItem[] = [];

  if (!snapshot) {
    items.push({
      key: "metadata",
      label: "Video details",
      state: "missing",
      detail:
        "Not collected yet. Fetch them from YouTube, or enter them by hand.",
      source: null,
      retrievedAt: null,
      needsRefresh: false,
    });
  } else {
    const absent = Object.entries(snapshot.fields)
      .filter(([, note]) => note && note.state !== "available")
      .map(([field]) =>
        METADATA_FIELD_LABELS[field as MetadataField].toLowerCase(),
      );
    const via =
      snapshot.source === "manual"
        ? "Entered by you"
        : "From the YouTube Data API";
    items.push({
      key: "metadata",
      label: "Video details",
      state: absent.length > 0 ? "partial" : "collected",
      detail: `${via} on ${snapshot.retrievedAt.slice(0, 10)}.${absent.length > 0 ? ` Missing or hidden: ${absent.join(", ")}.` : ""}`,
      source: snapshot.source,
      retrievedAt: snapshot.retrievedAt,
      needsRefresh: stale(snapshot.source, snapshot.retrievedAt),
    });
  }

  if (!sample) {
    items.push({
      key: "comments",
      label: "Public comments",
      state: "missing",
      detail: "Not retrieved.",
      source: null,
      retrievedAt: null,
      needsRefresh: false,
    });
  } else if (sample.status === "comments-disabled") {
    items.push({
      key: "comments",
      label: "Public comments",
      state: "hidden",
      detail: "Comments are turned off for this video.",
      source: "youtube-data-api",
      retrievedAt: sample.updatedAt,
      needsRefresh: false,
    });
  } else {
    items.push({
      key: "comments",
      label: "Public comments",
      state: sample.status === "complete" ? "collected" : "partial",
      detail: `${sampleScope(sample)}${sample.status === "complete" ? " Every top-level comment YouTube returned was retrieved." : " More are available."}`,
      source: "youtube-data-api",
      retrievedAt: sample.updatedAt,
      needsRefresh: stale("youtube-data-api", sample.updatedAt),
    });
  }

  if (transcripts.length === 0) {
    items.push({
      key: "transcript",
      label: "Transcript",
      state: "missing",
      detail:
        "None imported. Import a transcript you are allowed to use: your own, licensed or with permission.",
      source: null,
      retrievedAt: null,
      needsRefresh: false,
    });
  } else {
    for (const transcript of transcripts) {
      items.push({
        key: `transcript:${transcript.id}`,
        label: "Transcript",
        state: "collected",
        detail: `${transcript.fileName}: ${plural(transcript.wordCount, "word")}, ${transcript.hasTimestamps ? "with timestamps" : "without timestamps"}, ${transcript.language ? `language ${transcript.language} (declared)` : "language not declared"}.`,
        source: "transcript-file",
        retrievedAt: transcript.importedAt,
        needsRefresh: false,
      });
    }
  }
  return { items, unavailable: UNAVAILABLE_DATA };
}
