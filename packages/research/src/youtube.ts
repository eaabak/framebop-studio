/**
 * A small client for the YouTube Data API v3, read-only and keyed.
 *
 * Three documented endpoints are used, each costing one quota unit:
 *
 *   GET {endpoint}/videos?part=snippet,contentDetails,statistics,status,topicDetails&id=
 *   GET {endpoint}/channels?part=snippet,statistics&id=
 *   GET {endpoint}/commentThreads?part=snippet&videoId=&maxResults=100&order=&textFormat=plainText
 *
 * The key travels in the `x-goog-api-key` header rather than the query
 * string, so it never appears in a URL, a log line or an error message.
 * Redirects are refused. Caption text is not requested: the API serves it
 * only to a video's owner.
 */
import {
  AppError,
  type CommentOrder,
  EMPTY_METADATA,
  type FieldNote,
  type MetadataField,
  type VideoMetadata,
  type YouTubeFailure,
} from "@framebop/core";

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const COMMENT_PAGE_SIZE = 100;

export const VIDEO_PARTS =
  "snippet,contentDetails,statistics,status,topicDetails";
export const CHANNEL_PARTS = "snippet,statistics";

/**
 * Accepts the official endpoint, or for development and tests an `http`
 * address on this computer's loopback interface.
 */
export function checkYouTubeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("VALIDATION", "The YouTube API address is not a URL.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
  ) {
    throw new AppError(
      "VALIDATION",
      "The YouTube API address must use https (or http on this computer).",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function youTubeError(
  reason: YouTubeFailure,
  message: string,
  apiReason: string | null = null,
): AppError {
  return new AppError(
    reason === "not-found" ? "NOT_FOUND" : "UNAVAILABLE",
    message,
    {
      service: "youtube",
      reason,
      apiReason,
    },
  );
}

interface ApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    errors?: { reason?: unknown }[];
    details?: { reason?: unknown }[];
  };
}

function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The two reasons Google reports, the legacy one and the ErrorInfo one. */
export function apiReasonsOf(body: unknown): {
  reason: string | null;
  info: string | null;
  message: string | null;
} {
  const error = (body as ApiErrorBody | null)?.error;
  const reason = error?.errors?.find(
    (entry) => typeof entry.reason === "string",
  )?.reason as string | undefined;
  const info = error?.details?.find((entry) => typeof entry.reason === "string")
    ?.reason as string | undefined;
  return {
    reason: reason ?? null,
    info: info ?? null,
    message: typeof error?.message === "string" ? plain(error.message) : null,
  };
}

/** Turns an error response into a failure the interface can explain. */
export function failureFromResponse(status: number, body: unknown): AppError {
  const { reason, info, message } = apiReasonsOf(body);
  const apiReason = info ?? reason;
  if (info === "API_KEY_INVALID" || reason === "keyInvalid") {
    return youTubeError(
      "key-invalid",
      "YouTube did not accept the API key. Check it in Settings.",
      apiReason,
    );
  }
  if (info === "API_KEY_EXPIRED" || reason === "keyExpired") {
    return youTubeError(
      "key-invalid",
      "The YouTube API key has expired. Create a new one and enter it in Settings.",
      apiReason,
    );
  }
  if (info?.startsWith("API_KEY_") && info.endsWith("_BLOCKED")) {
    return youTubeError(
      "key-restricted",
      "This API key's restrictions do not allow requests from Framebop. Keys limited to websites, apps or IP addresses are refused here.",
      apiReason,
    );
  }
  if (reason === "accessNotConfigured" || info === "SERVICE_DISABLED") {
    return youTubeError(
      "api-disabled",
      "The YouTube Data API v3 is not enabled for this key's Google Cloud project. Enable it in the Google Cloud console, then try again.",
      apiReason,
    );
  }
  if (
    reason === "quotaExceeded" ||
    reason === "dailyLimitExceeded" ||
    info === "RATE_LIMIT_EXCEEDED_DAILY"
  ) {
    return youTubeError(
      "quota-exceeded",
      "This API key has used up today's YouTube Data API quota. It resets at midnight Pacific Time. Saved research stays available, and details can be entered by hand.",
      apiReason,
    );
  }
  if (
    status === 429 ||
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded"
  ) {
    return youTubeError(
      "rate-limited",
      "YouTube is limiting requests from this key. Wait a minute, then try again.",
      apiReason,
    );
  }
  if (status === 404 || reason === "videoNotFound" || reason === "notFound") {
    return youTubeError(
      "not-found",
      "YouTube has no public video with this id. It may be private, unlisted or removed.",
      apiReason,
    );
  }
  if (status >= 500) {
    return youTubeError(
      "server-error",
      `The YouTube API had a problem (status ${status}). Try again later.`,
      apiReason,
    );
  }
  if (status === 401 || status === 403) {
    return youTubeError(
      "forbidden",
      `YouTube refused the request${message ? `: ${message}` : "."}`,
      apiReason,
    );
  }
  return youTubeError(
    "bad-response",
    `The YouTube API answered with status ${status}${message ? `: ${message}` : "."}`,
    apiReason,
  );
}

export interface ApiItems {
  items: unknown[];
  nextPageToken: string | null;
}

export class YouTubeClient {
  readonly endpoint: string;

  constructor(
    endpoint: string = YOUTUBE_API,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = checkYouTubeEndpoint(endpoint);
  }

  private async get(
    resource: string,
    query: Record<string, string>,
    key: string,
    signal?: AbortSignal,
  ): Promise<ApiItems> {
    const url = new URL(`${this.endpoint}/${resource}`);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: "application/json", "x-goog-api-key": key },
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw youTubeError(
        "offline",
        timeout.aborted
          ? "YouTube did not answer in time. Check the connection and try again."
          : "YouTube could not be reached. You may be offline; saved research is still here, and details can be entered by hand.",
      );
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_RESPONSE_BYTES) {
      throw youTubeError("bad-response", "The YouTube API sent too much data.");
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok) throw failureFromResponse(response.status, body);
    if (typeof body !== "object" || body === null) {
      throw youTubeError(
        "bad-response",
        "The YouTube API sent a response that is not JSON.",
      );
    }
    const record = body as { items?: unknown; nextPageToken?: unknown };
    return {
      items: Array.isArray(record.items) ? record.items : [],
      nextPageToken:
        typeof record.nextPageToken === "string" && record.nextPageToken
          ? record.nextPageToken
          : null,
    };
  }

  /** The video's public resource, or null when YouTube has none. */
  async video(
    videoId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<unknown | null> {
    const { items } = await this.get(
      "videos",
      { part: VIDEO_PARTS, id: videoId },
      key,
      signal,
    );
    return items[0] ?? null;
  }

  async channel(
    channelId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<unknown | null> {
    const { items } = await this.get(
      "channels",
      { part: CHANNEL_PARTS, id: channelId },
      key,
      signal,
    );
    return items[0] ?? null;
  }

  /**
   * One page of top-level comments. Resolves to null when the video's
   * comments are turned off, which is a fact about the video, not a failure.
   */
  async commentPage(
    options: { videoId: string; order: CommentOrder; pageToken: string | null },
    key: string,
    signal?: AbortSignal,
  ): Promise<{
    comments: FetchedComment[];
    nextPageToken: string | null;
  } | null> {
    let page: ApiItems;
    try {
      page = await this.get(
        "commentThreads",
        {
          part: "snippet",
          videoId: options.videoId,
          maxResults: String(COMMENT_PAGE_SIZE),
          order: options.order,
          textFormat: "plainText",
          ...(options.pageToken ? { pageToken: options.pageToken } : {}),
        },
        key,
        signal,
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.details as { apiReason?: string } | undefined)?.apiReason ===
          "commentsDisabled"
      ) {
        return null;
      }
      throw error;
    }
    return {
      comments: page.items
        .map(normalizeCommentThread)
        .filter((comment): comment is FetchedComment => comment !== null),
      nextPageToken: page.nextPageToken,
    };
  }
}

// ------------------------------------------------------------ normalizing

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The API sends counts as decimal strings. */
function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d{1,15}$/.test(value))
    return Number(value);
  return null;
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((item): item is string => typeof item === "string");
  return list.length > 0 ? list : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Parses an ISO 8601 duration as YouTube uses it (PT1H2M3S, P1DT2H). Returns
 * null for anything else, rather than guessing.
 */
export function parseIsoDuration(value: string): number | null {
  const match =
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!match || value === "P" || value.endsWith("T")) return null;
  const [, weeks, days, hours, minutes, seconds] = match;
  return (
    Number(weeks ?? 0) * 604_800 +
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

function largestThumbnail(thumbnails: unknown): string | null {
  const all = object(thumbnails);
  if (!all) return null;
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const url = string(object(all[size])?.url);
    if (url) return url;
  }
  return null;
}

export interface NormalizedVideo {
  metadata: VideoMetadata;
  fields: Partial<Record<MetadataField, FieldNote>>;
}

/**
 * Maps a `videos.list` item, and the `channels.list` item of its channel if
 * one was retrieved, onto Framebop's metadata, recording for each missing
 * value why it is missing when the API makes that clear.
 */
export function normalizeVideo(
  video: unknown,
  channel: unknown | null,
): NormalizedVideo {
  const item = object(video) ?? {};
  const snippet = object(item.snippet);
  const details = object(item.contentDetails);
  const statistics = object(item.statistics);
  const status = object(item.status);
  const topics = object(item.topicDetails);

  const live = string(snippet?.liveBroadcastContent);
  const liveState =
    live === "live" || live === "upcoming" || live === "none" ? live : null;
  const isLive = liveState === "live" || liveState === "upcoming";
  const duration = string(details?.duration);
  const durationSeconds = duration ? parseIsoDuration(duration) : null;
  const caption = string(details?.caption);
  const definition = string(details?.definition);

  const channelItem = object(channel);
  const channelSnippet = object(channelItem?.snippet);
  const channelStatistics = object(channelItem?.statistics);
  const subscribersHidden = channelStatistics?.hiddenSubscriberCount === true;

  const metadata: VideoMetadata = {
    ...EMPTY_METADATA,
    title: string(snippet?.title),
    description: string(snippet?.description),
    publishedAt: string(snippet?.publishedAt),
    durationSeconds: isLive || durationSeconds === 0 ? null : durationSeconds,
    channelId: string(snippet?.channelId),
    channelTitle: string(snippet?.channelTitle),
    viewCount: count(statistics?.viewCount),
    likeCount: count(statistics?.likeCount),
    commentCount: count(statistics?.commentCount),
    tags: strings(snippet?.tags),
    categoryId: string(snippet?.categoryId),
    defaultLanguage: string(snippet?.defaultLanguage),
    defaultAudioLanguage: string(snippet?.defaultAudioLanguage),
    captionsAvailable:
      caption === "true" ? true : caption === "false" ? false : null,
    definition: definition === "hd" || definition === "sd" ? definition : null,
    liveBroadcastContent: liveState,
    madeForKids: bool(status?.madeForKids),
    topicCategories: strings(topics?.topicCategories),
    thumbnailUrl: largestThumbnail(snippet?.thumbnails),
    channelHandle: string(channelSnippet?.customUrl),
    channelSubscriberCount: subscribersHidden
      ? null
      : count(channelStatistics?.subscriberCount),
    channelVideoCount: count(channelStatistics?.videoCount),
    channelViewCount: count(channelStatistics?.viewCount),
    channelCountry: string(channelSnippet?.country),
    channelPublishedAt: string(channelSnippet?.publishedAt),
  };

  const fields: Partial<Record<MetadataField, FieldNote>> = {};
  const note = (field: MetadataField, value: FieldNote) => {
    fields[field] = value;
  };
  // A more specific reason recorded earlier (hidden, not applicable) wins.
  const missing = (field: MetadataField, text: string) => {
    if (metadata[field] === null && !fields[field]) {
      note(field, { state: "not-provided", note: text });
    }
  };

  if (isLive) {
    note("durationSeconds", {
      state: "not-applicable",
      note: "Not final while the video is live or scheduled.",
    });
  } else {
    missing("durationSeconds", "The API returned no duration.");
  }
  if (statistics) {
    if (metadata.likeCount === null) {
      note("likeCount", {
        state: "hidden",
        note: "Not returned by the API. The owner may have hidden it.",
      });
    }
    if (metadata.commentCount === null) {
      note("commentCount", {
        state: "hidden",
        note: "Not returned by the API. Comments may be turned off for this video.",
      });
    }
    missing("viewCount", "Not returned by the API.");
  } else {
    for (const field of ["viewCount", "likeCount", "commentCount"] as const) {
      missing(field, "The API returned no statistics for this video.");
    }
  }
  missing("tags", "The video has no public tags.");
  missing(
    "defaultLanguage",
    "The uploader did not set a language for the title and description.",
  );
  missing(
    "defaultAudioLanguage",
    "The uploader did not set the audio language.",
  );
  missing("topicCategories", "The API returned no topic categories.");
  missing("description", "The video has no description.");
  missing("madeForKids", "Not returned by the API.");
  if (metadata.captionsAvailable === true) {
    note("captionsAvailable", {
      state: "available",
      note: "Caption text is not retrieved: the API lets only the video's owner download it. Import a transcript you may use instead.",
    });
  }
  if (metadata.thumbnailUrl !== null) {
    note("thumbnailUrl", {
      state: "available",
      note: "Recorded, not loaded. Framebop does not download images or video from YouTube.",
    });
  }

  const channelFields = [
    "channelHandle",
    "channelSubscriberCount",
    "channelVideoCount",
    "channelViewCount",
    "channelCountry",
    "channelPublishedAt",
  ] as const;
  if (!channelItem) {
    for (const field of channelFields) {
      note(field, {
        state: "not-provided",
        note: "Channel details were not retrieved.",
      });
    }
  } else {
    if (subscribersHidden) {
      note("channelSubscriberCount", {
        state: "hidden",
        note: "The channel hides its subscriber count.",
      });
    } else if (metadata.channelSubscriberCount !== null) {
      note("channelSubscriberCount", {
        state: "available",
        note: "YouTube rounds public subscriber counts down to three significant figures.",
      });
    }
    missing("channelCountry", "The channel does not show a country.");
    missing("channelHandle", "The channel has no handle.");
    missing("channelSubscriberCount", "Not returned by the API.");
    missing("channelVideoCount", "Not returned by the API.");
    missing("channelViewCount", "Not returned by the API.");
    missing("channelPublishedAt", "Not returned by the API.");
  }
  return { metadata, fields };
}

export interface FetchedComment {
  commentId: string;
  text: string;
  likeCount: number | null;
  replyCount: number | null;
  publishedAt: string | null;
}

const MAX_COMMENT_CHARS = 10_000;

/** A `commentThreads.list` item, without its author. */
export function normalizeCommentThread(thread: unknown): FetchedComment | null {
  const item = object(thread);
  const snippet = object(item?.snippet);
  const top = object(snippet?.topLevelComment);
  const topSnippet = object(top?.snippet);
  const commentId = string(top?.id) ?? string(item?.id);
  const text =
    typeof topSnippet?.textDisplay === "string" ? topSnippet.textDisplay : null;
  if (!commentId || text === null) return null;
  return {
    commentId,
    text: text.slice(0, MAX_COMMENT_CHARS),
    likeCount: count(topSnippet?.likeCount),
    replyCount: count(snippet?.totalReplyCount),
    publishedAt: string(topSnippet?.publishedAt),
  };
}
