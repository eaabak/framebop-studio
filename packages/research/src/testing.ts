/**
 * A stand-in for the YouTube Data API, for tests and development. Not part
 * of the bundle. Its error bodies follow the shapes the real API returns.
 */
import { type Server, createServer } from "node:http";

/** The only key the stand-in accepts. */
export const FIXTURE_API_KEY = "AIzaFixtureKeyForFramebopTests000000000";

/** Public statistics, captions, a channel and 250 comments over 3 pages. */
export const FIXTURE_VIDEO = "Fx1DnaTest0";
/** Likes and comment count hidden, comments off, subscriber count hidden. */
export const HIDDEN_VIDEO = "HiddenStat1";
/** A live stream: no final duration. */
export const LIVE_VIDEO = "LiveStream1";
/** Unknown to the API: videos.list returns no items. */
export const MISSING_VIDEO = "NotThere001";

export const FIXTURE_COMMENT_COUNT = 250;

const CHANNEL = "UCfixtureKitchen000000000";
const HIDDEN_CHANNEL = "UChiddenCounts00000000000";

const VIDEOS: Record<string, unknown> = {
  [FIXTURE_VIDEO]: {
    kind: "youtube#video",
    id: FIXTURE_VIDEO,
    snippet: {
      publishedAt: "2026-03-02T15:00:00Z",
      channelId: CHANNEL,
      title: "Crispy Oven Potatoes, Three Ways",
      description: "Three ways to make crispy potatoes in the oven.",
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${FIXTURE_VIDEO}/default.jpg` },
        maxres: {
          url: `https://i.ytimg.com/vi/${FIXTURE_VIDEO}/maxresdefault.jpg`,
        },
      },
      channelTitle: "Fixture Kitchen",
      tags: ["potatoes", "oven", "recipe"],
      categoryId: "26",
      liveBroadcastContent: "none",
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    contentDetails: {
      duration: "PT12M34S",
      dimension: "2d",
      definition: "hd",
      caption: "true",
      licensedContent: true,
    },
    status: { privacyStatus: "public", madeForKids: false, embeddable: true },
    statistics: {
      viewCount: "1234567",
      likeCount: "45678",
      favoriteCount: "0",
      commentCount: "4321",
    },
    topicDetails: { topicCategories: ["https://en.wikipedia.org/wiki/Food"] },
  },
  [HIDDEN_VIDEO]: {
    kind: "youtube#video",
    id: HIDDEN_VIDEO,
    snippet: {
      publishedAt: "2025-11-20T09:30:00Z",
      channelId: HIDDEN_CHANNEL,
      title: "A video with hidden counts",
      description: "",
      thumbnails: {},
      channelTitle: "Quiet Channel",
      categoryId: "22",
      liveBroadcastContent: "none",
    },
    contentDetails: { duration: "PT45S", definition: "sd", caption: "false" },
    status: { privacyStatus: "public" },
    statistics: { viewCount: "1000", favoriteCount: "0" },
  },
  [LIVE_VIDEO]: {
    kind: "youtube#video",
    id: LIVE_VIDEO,
    snippet: {
      publishedAt: "2026-10-14T08:00:00Z",
      channelId: CHANNEL,
      title: "Live: cooking along",
      channelTitle: "Fixture Kitchen",
      liveBroadcastContent: "live",
    },
    contentDetails: { duration: "P0D", definition: "hd", caption: "false" },
    statistics: { viewCount: "870", likeCount: "52" },
  },
};

const CHANNELS: Record<string, unknown> = {
  [CHANNEL]: {
    kind: "youtube#channel",
    id: CHANNEL,
    snippet: {
      title: "Fixture Kitchen",
      customUrl: "@fixturekitchen",
      publishedAt: "2015-05-01T00:00:00Z",
      country: "GB",
    },
    statistics: {
      viewCount: "98765432",
      subscriberCount: "512000",
      hiddenSubscriberCount: false,
      videoCount: "321",
    },
  },
  [HIDDEN_CHANNEL]: {
    kind: "youtube#channel",
    id: HIDDEN_CHANNEL,
    snippet: { title: "Quiet Channel", publishedAt: "2020-01-01T00:00:00Z" },
    statistics: {
      viewCount: "50000",
      hiddenSubscriberCount: true,
      videoCount: "12",
    },
  },
};

const COMMENT_TEXTS = [
  "The recipe worked perfectly, crispy potatoes every time",
  "What temperature should the oven be for the second recipe?",
  "At 4:12 the butter trick is genius",
  "I used olive oil instead of butter and they were still crispy",
  "Can you make a vegan version? The recipe looks great",
  "4:20 is my favourite part",
  "Tried the oven method tonight, family loved it",
  "Which potatoes are best, waxy or floury?",
  "Great video",
  "This channel taught me to cook",
];

/** The fixture video's comments, in relevance order. */
export function fixtureComments(): {
  id: string;
  text: string;
  likeCount: number;
  replyCount: number;
  publishedAt: string;
}[] {
  return Array.from({ length: FIXTURE_COMMENT_COUNT }, (_, index) => ({
    id: `UgxFixture${String(index).padStart(4, "0")}`,
    text: `${COMMENT_TEXTS[index % COMMENT_TEXTS.length]} (${index + 1})`,
    likeCount: (index * 37) % 500,
    replyCount: index % 4,
    publishedAt: new Date(
      Date.UTC(2026, 2, 3) + index * 3_600_000,
    ).toISOString(),
  }));
}

function thread(comment: ReturnType<typeof fixtureComments>[number]) {
  return {
    kind: "youtube#commentThread",
    id: comment.id,
    snippet: {
      videoId: FIXTURE_VIDEO,
      topLevelComment: {
        kind: "youtube#comment",
        id: comment.id,
        snippet: {
          // Authors are part of the real response; Framebop never stores them.
          authorDisplayName: "@someone",
          authorChannelId: { value: "UCsomeone000000000000000" },
          textDisplay: comment.text,
          likeCount: comment.likeCount,
          publishedAt: comment.publishedAt,
          updatedAt: comment.publishedAt,
        },
      },
      canReply: true,
      totalReplyCount: comment.replyCount,
      isPublic: true,
    },
  };
}

// Error bodies as the API sends them.
const KEY_INVALID = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    errors: [
      {
        message: "API key not valid. Please pass a valid API key.",
        domain: "global",
        reason: "badRequest",
      },
    ],
    status: "INVALID_ARGUMENT",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "API_KEY_INVALID",
        domain: "googleapis.com",
        metadata: { service: "youtube.googleapis.com" },
      },
    ],
  },
};

const NO_KEY = {
  error: {
    code: 403,
    message:
      "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
    errors: [
      {
        message: "Method doesn't allow unregistered callers.",
        domain: "global",
        reason: "forbidden",
      },
    ],
    status: "PERMISSION_DENIED",
  },
};

const QUOTA = {
  error: {
    code: 403,
    message:
      'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.',
    errors: [
      {
        message:
          'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.',
        domain: "youtube.quota",
        reason: "quotaExceeded",
      },
    ],
  },
};

const API_DISABLED = {
  error: {
    code: 403,
    message:
      "YouTube Data API v3 has not been used in project 123456 before or it is disabled.",
    errors: [
      {
        message:
          "YouTube Data API v3 has not been used in project 123456 before or it is disabled.",
        domain: "usageLimits",
        reason: "accessNotConfigured",
      },
    ],
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "SERVICE_DISABLED",
        domain: "googleapis.com",
      },
    ],
  },
};

const COMMENTS_DISABLED = {
  error: {
    code: 403,
    message:
      'The video identified by the <code><a href="/youtube/v3/docs/commentThreads/list#videoId">videoId</a></code> parameter has disabled comments.',
    errors: [
      {
        message:
          "The video identified by the videoId parameter has disabled comments.",
        domain: "youtube.commentThread",
        reason: "commentsDisabled",
        location: "videoId",
        locationType: "parameter",
      },
    ],
  },
};

const VIDEO_NOT_FOUND = {
  error: {
    code: 404,
    message:
      "The video identified by the videoId parameter could not be found.",
    errors: [
      {
        message:
          "The video identified by the videoId parameter could not be found.",
        domain: "youtube.commentThread",
        reason: "videoNotFound",
      },
    ],
  },
};

export interface YouTubeBehaviour {
  /** Fail every request this way. */
  failure?:
    "quota" | "api-disabled" | "rate-limited" | "server-error" | "not-json";
  /** Only for this resource. */
  failOn?: "videos" | "channels" | "commentThreads";
}

export interface TestYouTube {
  endpoint: string;
  /** Every request: the resource, its query and the key header it carried. */
  requests: {
    resource: string;
    query: Record<string, string>;
    key: string | null;
  }[];
  behaviour: YouTubeBehaviour;
  close(): Promise<void>;
}

export async function startTestYouTube(
  behaviour: YouTubeBehaviour = {},
): Promise<TestYouTube> {
  const state: TestYouTube = {
    endpoint: "",
    requests: [],
    behaviour,
    close: async () => {},
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const resource = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const query = Object.fromEntries(url.searchParams);
    const keyHeader = request.headers["x-goog-api-key"];
    const key = typeof keyHeader === "string" ? keyHeader : null;
    state.requests.push({ resource, query, key });

    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json; charset=UTF-8",
      });
      response.end(JSON.stringify(body));
    };

    if (!key && !query.key) return send(403, NO_KEY);
    if ((key ?? query.key) !== FIXTURE_API_KEY) return send(400, KEY_INVALID);

    const { failure, failOn } = state.behaviour;
    if (failure && (!failOn || failOn === resource)) {
      if (failure === "quota") return send(403, QUOTA);
      if (failure === "api-disabled") return send(403, API_DISABLED);
      if (failure === "rate-limited") {
        return send(429, {
          error: {
            code: 429,
            message: "Too many requests",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        });
      }
      if (failure === "server-error") {
        return send(503, {
          error: {
            code: 503,
            message: "The service is currently unavailable.",
            errors: [{ reason: "backendError" }],
          },
        });
      }
      response.writeHead(200, { "content-type": "text/html" });
      return response.end("<html>not json</html>");
    }

    if (resource === "videos") {
      const item = VIDEOS[query.id ?? ""];
      return send(200, {
        kind: "youtube#videoListResponse",
        items: item ? [item] : [],
        pageInfo: { totalResults: item ? 1 : 0, resultsPerPage: 1 },
      });
    }
    if (resource === "channels") {
      const item = CHANNELS[query.id ?? ""];
      return send(200, {
        kind: "youtube#channelListResponse",
        items: item ? [item] : [],
      });
    }
    if (resource === "commentThreads") {
      const videoId = query.videoId ?? "";
      if (videoId === HIDDEN_VIDEO) return send(403, COMMENTS_DISABLED);
      if (videoId === LIVE_VIDEO)
        return send(200, {
          kind: "youtube#commentThreadListResponse",
          items: [],
        });
      if (videoId !== FIXTURE_VIDEO) return send(404, VIDEO_NOT_FOUND);
      const size = Math.min(100, Number(query.maxResults ?? 20));
      const page = query.pageToken
        ? Number(query.pageToken.replace("page-", ""))
        : 1;
      const all = fixtureComments();
      const ordered = query.order === "time" ? [...all].reverse() : all;
      const items = ordered.slice((page - 1) * size, page * size).map(thread);
      const more = page * size < ordered.length;
      return send(200, {
        kind: "youtube#commentThreadListResponse",
        ...(more ? { nextPageToken: `page-${page + 1}` } : {}),
        pageInfo: { totalResults: items.length, resultsPerPage: size },
        items,
      });
    }
    return send(404, {
      error: {
        code: 404,
        message: "Not Found",
        errors: [{ reason: "notFound" }],
      },
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  state.endpoint = `http://127.0.0.1:${port}/youtube/v3`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}
