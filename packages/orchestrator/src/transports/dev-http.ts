import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import { IdSchema, toErrorShape } from "@framebop/core";
import type { Engine } from "../engine";
import { resolveMediaPath } from "../paths";

const LOOPBACK = "127.0.0.1";
// Large enough for a voice recording (voices.saveRecording).
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface DevBridgeOptions {
  port: number;
  /** Shared secret every request must present as a bearer token. */
  token: string;
}

export interface DevBridge {
  port: number;
  close(): Promise<void>;
}

/**
 * Development-only HTTP bridge, used to run the interface in an ordinary
 * browser (`pnpm dev:web`) where the desktop shell's IPC does not exist.
 *
 * It is not part of the packaged application. Even so it is locked down,
 * because any local web page can attempt requests to a loopback port:
 *   - it binds to 127.0.0.1 only, never to a network interface;
 *   - every request needs a random per-run bearer token, which the Vite dev
 *     server adds when proxying, so the token never reaches browser code;
 *   - the Host header must be the loopback address, defeating DNS rebinding;
 *   - no CORS headers are sent, so cross-origin pages cannot read responses.
 */
export async function serveDevBridge(
  engine: Engine,
  options: DevBridgeOptions,
): Promise<DevBridge> {
  if (options.token.length < 32) {
    throw new Error("The dev bridge token must be at least 32 characters.");
  }
  const expectedToken = Buffer.from(`Bearer ${options.token}`);
  const log = engine.context.log.scope("dev-bridge");

  const authorized = (request: IncomingMessage, port: number): boolean => {
    const host = request.headers.host;
    if (host !== `${LOOPBACK}:${port}` && host !== `localhost:${port}`)
      return false;
    const presented = Buffer.from(request.headers.authorization ?? "");
    return (
      presented.length === expectedToken.length &&
      timingSafeEqual(presented, expectedToken)
    );
  };

  const server: Server = createServer((request, response) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!authorized(request, port)) {
      response.writeHead(403).end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${LOOPBACK}`);
    route(engine, request, response, url).catch((error: unknown) => {
      log.error("Request failed", {
        path: url.pathname,
        reason: String(error),
      });
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, LOOPBACK, resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : options.port;
  log.info("Development bridge listening", { address: `${LOOPBACK}:${port}` });

  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function route(
  engine: Engine,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if (request.method === "POST" && url.pathname === "/rpc") {
    return handleRpc(engine, request, response);
  }
  if (request.method === "GET" && url.pathname === "/events") {
    return handleEvents(engine, request, response);
  }
  const render = /^\/renders\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && render?.[1]) {
    // Only files the engine recorded as renders, never an arbitrary path.
    const record = engine.context.db.renders.get(render[1]);
    if (!record) {
      response.writeHead(404).end();
      return;
    }
    return streamFile(request, response, record.path, "video/mp4");
  }
  // Scene Doctor's evidence pictures, by report and file name only.
  const frame = /^\/inspections\/([^/]+)\/(frame-\d{1,3}\.jpg)$/.exec(
    url.pathname,
  );
  if (request.method === "GET" && frame?.[1] && frame[2]) {
    if (
      !IdSchema.safeParse(frame[1]).success ||
      !engine.context.db.inspections.get(frame[1])
    ) {
      response.writeHead(404).end();
      return;
    }
    return streamFile(
      request,
      response,
      join(engine.context.paths.mediaRoot, "inspections", frame[1], frame[2]),
      "image/jpeg",
    );
  }
  const media = /^\/media\/([^/]+)(\/thumbnail)?$/.exec(url.pathname);
  if (request.method === "GET" && media?.[1]) {
    return handleMedia(
      engine,
      request,
      response,
      media[1],
      media[2] !== undefined,
    );
  }
  response.writeHead(404).end();
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleRpc(
  engine: Engine,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let payload: unknown;
  try {
    const call = JSON.parse(await readBody(request)) as {
      method?: unknown;
      params?: unknown;
    };
    if (typeof call.method !== "string") throw new Error("Missing method.");
    payload = {
      ok: true,
      result: await engine.dispatch(call.method, call.params),
    };
  } catch (error) {
    payload = { ok: false, error: toErrorShape(error) };
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function handleEvents(
  engine: Engine,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(": connected\n\n");
  const unsubscribe = engine.subscribe((event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  // Comment lines keep idle proxies from closing the stream.
  const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
  request.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/** Streams a library file with HTTP range support, which video seeking needs. */
async function handleMedia(
  engine: Engine,
  request: IncomingMessage,
  response: ServerResponse,
  assetId: string,
  thumbnail: boolean,
): Promise<void> {
  const { db, paths } = engine.context;
  const asset = IdSchema.safeParse(assetId).success
    ? db.assets.get(assetId)
    : null;
  const relativePath = thumbnail ? asset?.thumbnailPath : asset?.relativePath;
  if (!asset || !relativePath) {
    response.writeHead(404).end();
    return;
  }

  const filePath = resolveMediaPath(paths.mediaRoot, relativePath);
  return streamFile(
    request,
    response,
    filePath,
    thumbnail ? "image/jpeg" : asset.mimeType,
  );
}

async function streamFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  contentType: string,
): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    response.writeHead(404).end();
    return;
  }

  const headers = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (!range) {
    response.writeHead(200, { ...headers, "content-length": info.size });
    createReadStream(filePath).pipe(response);
    return;
  }

  const last = info.size - 1;
  // "bytes=-N" means the final N bytes.
  const start = range[1]
    ? Number(range[1])
    : Math.max(0, info.size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), last) : last;
  if (!Number.isFinite(start) || start > end || start > last) {
    response.writeHead(416, { "content-range": `bytes */${info.size}` }).end();
    return;
  }
  response.writeHead(206, {
    ...headers,
    "content-range": `bytes ${start}-${end}/${info.size}`,
    "content-length": end - start + 1,
  });
  createReadStream(filePath, { start, end }).pipe(response);
}
