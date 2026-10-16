/** A stand-in for the Hugging Face Hub, for tests. Not part of the bundle. */
import { createHash } from "node:crypto";
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { CatalogEntry, ModelFile } from "@framebop/core";

export interface HubBehaviour {
  /** Close the connection after sending this many bytes of a file, once. */
  dropAfterBytes?: number;
  /** Answer range requests with the whole file, as some servers do. */
  ignoreRange?: boolean;
  /** Flip a byte, so the content no longer matches its hash. */
  corrupt?: boolean;
  /** Delay between chunks, to leave time to cancel. */
  chunkDelayMs?: number;
  /** Answer every file request with this status. */
  status?: number;
  /** Answer API requests (search and model details) with this status. */
  apiStatus?: number;
}

/** Repositories the test hub's search and details endpoints know about. */
export const OTHER_REPO = "other-org/diffusion-model";
export const GATED_REPO = "gated-org/gated-model";

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const REPO = "test-org/test-model";

export function gitBlobId(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Describes files the way the hub does: LFS for large files, Git blobs for small. */
export function describeFiles(files: Record<string, Buffer>): ModelFile[] {
  return Object.entries(files).map(([path, content]) => {
    const lfs = content.length > 512;
    return {
      path,
      sizeBytes: content.length,
      sha256: lfs ? sha256(content) : null,
      gitBlobId: lfs ? null : gitBlobId(content),
    };
  });
}

export function catalogEntryFor(
  files: Record<string, Buffer>,
  overrides: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    id: "test-model",
    name: "Test model",
    description: "A model served by the test hub.",
    source: "huggingface",
    repoId: REPO,
    revision: COMMIT,
    family: "Test",
    task: "other",
    variant: "fixture",
    quantization: null,
    format: "onnx",
    files: describeFiles(files),
    runtime: { id: "test-runtime", name: "Test runtime" },
    hardware: {
      accelerators: ["cpu"],
      minimumMemoryBytes: null,
      source: null,
      notes: [],
    },
    license: {
      id: "apache-2.0",
      name: "Apache License 2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
      summary: "Test.",
    },
    access: { gated: false, requirements: null },
    pageUrl: "https://example.invalid/test-model",
    verifiedOn: "2026-10-14",
    provider: "test-org",
    group: null,
    categories: ["other"],
    platforms: null,
    presets: [],
    parts: [],
    inferenceTests: [],
    origin: "registry",
    llm: null,
    ...overrides,
  };
}

/** Large deterministic content, so tests can download several chunks. */
export function payload(bytes: number, seed = 1): Buffer {
  const content = Buffer.alloc(bytes);
  let state = seed;
  for (let i = 0; i < bytes; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    content[i] = state & 0xff;
  }
  return content;
}

export interface TestHub {
  endpoint: string;
  /** Every request seen: path, query and range header. */
  requests: { path: string; query: string; range: string | null }[];
  behaviour: HubBehaviour;
  close(): Promise<void>;
}

export async function startTestHub(
  files: Record<string, Buffer>,
  behaviour: HubBehaviour = {},
): Promise<TestHub> {
  const requests: TestHub["requests"] = [];
  const state = { behaviour, dropped: false };

  const serveFile = async (
    request: IncomingMessage,
    response: ServerResponse,
    content: Buffer,
  ) => {
    const { behaviour: current } = state;
    if (current.status) {
      response.writeHead(current.status).end();
      return;
    }
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? "");
    const start = range && !current.ignoreRange ? Number(range[1]) : 0;
    let body = content.subarray(start);
    if (current.corrupt) {
      body = Buffer.from(body);
      body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 0xff;
    }
    response.writeHead(start > 0 ? 206 : 200, {
      "content-length": body.length,
      ...(start > 0
        ? {
            "content-range": `bytes ${start}-${content.length - 1}/${content.length}`,
          }
        : {}),
    });
    const chunk = 64 * 1024;
    for (let offset = 0; offset < body.length; offset += chunk) {
      if (
        current.dropAfterBytes !== undefined &&
        !state.dropped &&
        offset >= current.dropAfterBytes
      ) {
        state.dropped = true;
        response.destroy();
        return;
      }
      if (current.chunkDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, current.chunkDelayMs),
        );
      }
      if (response.destroyed) return;
      // Wait until each chunk has been handed to the operating system, so a
      // later drop happens mid-body and never discards data already sent.
      // Waiting only for "drain" left the last chunk in Node's own buffer,
      // where destroying the socket could lose it on a busy machine.
      await new Promise((resolve) =>
        response.write(body.subarray(offset, offset + chunk), resolve),
      );
    }
    response.end();
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({
      path: url.pathname,
      query: url.search,
      range: request.headers.range ?? null,
    });
    const json = (body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(200, {
        "content-type": "application/json",
        ...headers,
      });
      response.end(JSON.stringify(body));
    };
    if (
      state.behaviour.apiStatus &&
      url.pathname.startsWith("/api/models") &&
      !url.pathname.includes("/revision/")
    ) {
      response.writeHead(state.behaviour.apiStatus, {
        ratelimit: '"api";r=0;t=42',
      });
      response.end();
      return;
    }
    // Model search: two pages of one result each.
    if (url.pathname === "/api/models") {
      const second = url.searchParams.get("cursor") === "page-2";
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      json(
        second
          ? [
              {
                id: OTHER_REPO,
                pipeline_tag: "text-to-image",
                likes: 3,
                downloads: 40,
                tags: ["license:other"],
              },
            ]
          : [
              {
                id: REPO,
                pipeline_tag: "text-to-speech",
                likes: 7,
                downloads: 900,
                tags: ["license:apache-2.0", "en"],
              },
            ],
        second
          ? {}
          : {
              link: `<${origin}/api/models?${url.searchParams.toString()}&cursor=page-2>; rel="next"`,
            },
      );
      return;
    }
    const siblings = () =>
      describeFiles(files).map((file) => ({
        rfilename: file.path,
        size: file.sizeBytes,
        blobId: file.gitBlobId ?? "f".repeat(40),
        lfs: file.sha256
          ? { sha256: file.sha256, size: file.sizeBytes }
          : undefined,
      }));
    if (
      url.pathname === `/api/models/${REPO}` ||
      url.pathname === `/api/models/${GATED_REPO}`
    ) {
      const gated = url.pathname.endsWith(GATED_REPO);
      json({
        id: gated ? GATED_REPO : REPO,
        author: gated ? "gated-org" : "test-org",
        sha: COMMIT,
        gated: gated ? "manual" : false,
        pipeline_tag: "text-to-speech",
        cardData: { license: "apache-2.0" },
        downloads: 900,
        likes: 7,
        lastModified: "2026-10-01T00:00:00.000Z",
        siblings: siblings(),
      });
      return;
    }
    if (url.pathname === `/api/models/${OTHER_REPO}`) {
      json({
        id: OTHER_REPO,
        sha: COMMIT,
        gated: false,
        pipeline_tag: "text-to-image",
        cardData: { license: "other", license_name: "custom" },
        siblings: [
          { rfilename: "model_index.json", size: 500, blobId: "a".repeat(40) },
          {
            rfilename: "unet/diffusion.safetensors",
            size: 9_000_000_000,
            lfs: { sha256: "b".repeat(64) },
          },
        ],
      });
      return;
    }
    if (url.pathname === `/api/models/${REPO}/revision/${COMMIT}`) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sha: COMMIT,
          gated: false,
          siblings: describeFiles(files).map((file) => ({
            rfilename: file.path,
            size: file.sizeBytes,
            blobId: file.gitBlobId ?? "f".repeat(40),
            lfs: file.sha256
              ? { sha256: file.sha256, size: file.sizeBytes }
              : undefined,
          })),
        }),
      );
      return;
    }
    const prefix = `/${REPO}/resolve/${COMMIT}/`;
    if (url.pathname.startsWith(prefix)) {
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      const content = files[path];
      if (!content) {
        response.writeHead(404).end();
        return;
      }
      void serveFile(request, response, content);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    get behaviour() {
      return state.behaviour;
    },
    set behaviour(value: HubBehaviour) {
      state.behaviour = value;
      state.dropped = false;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
