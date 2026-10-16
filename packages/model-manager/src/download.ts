/**
 * Resumable, verified download of one published file.
 *
 * Bytes are streamed to "<file>.part" and hashed as they arrive, so memory
 * use stays flat whatever the file size. After an interruption the partial
 * file is kept: the next attempt hashes what is already there and asks the
 * server for the rest with an HTTP range request. Only a file whose size and
 * hash match the published values is renamed to its final name, so a file
 * without the ".part" suffix is always complete and correct.
 */
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { AppError, type ModelFile } from "@framebop/core";
import { FileDigest } from "./hash";

export interface DownloadOptions {
  url: string;
  file: ModelFile;
  finalPath: string;
  partialPath: string;
  signal: AbortSignal;
  /** Called with how many bytes of this file are on disk and accounted for. */
  onBytes(bytes: number): void;
  /**
   * Called once the transfer starts: `offset` is where the server continues
   * from, which is 0 unless it accepted a range request for a partial file.
   */
  onTransfer?(offset: number): void;
  fetchImpl?: typeof fetch;
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/** Feeds an existing file through the digest, reporting progress as it goes. */
async function hashExisting(
  path: string,
  digest: FileDigest,
  onBytes: (bytes: number) => void,
  signal: AbortSignal,
): Promise<void> {
  let read = 0;
  await pipeline(
    createReadStream(path),
    async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) {
        digest.update(chunk);
        read += chunk.length;
        onBytes(read);
      }
    },
    { signal },
  );
}

function rangeStart(header: string | null): number | null {
  const match = header
    ? /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(header.trim())
    : null;
  return match?.[1] ? Number(match[1]) : null;
}

function describeStatus(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError(
      "UNAVAILABLE",
      "The server refused the download. The model may be gated or require signing in.",
    );
  }
  if (status === 404) {
    return new AppError("NOT_FOUND", "The file was not found on the server.");
  }
  return new AppError(
    "UNAVAILABLE",
    `The server answered with status ${status}.`,
  );
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

export async function downloadVerifiedFile(
  options: DownloadOptions,
): Promise<void> {
  const { file, finalPath, partialPath, signal, onBytes } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  await mkdir(dirname(finalPath), { recursive: true });

  // Already complete from an earlier attempt? Confirm rather than trust it.
  if ((await sizeOf(finalPath)) === file.sizeBytes) {
    const digest = new FileDigest(file);
    await hashExisting(finalPath, digest, onBytes, signal);
    if (digest.matches()) return;
    await rm(finalPath, { force: true });
  }

  let have = (await sizeOf(partialPath)) ?? 0;
  if (have > file.sizeBytes) {
    await rm(partialPath, { force: true });
    have = 0;
  }
  let digest = new FileDigest(file);
  if (have > 0) await hashExisting(partialPath, digest, onBytes, signal);

  if (have < file.sizeBytes) {
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        headers: have > 0 ? { range: `bytes=${have}-` } : {},
        redirect: "follow",
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AppError(
        "UNAVAILABLE",
        `The download could not be started: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let append = have > 0;
    if (response.status === 206) {
      if (rangeStart(response.headers.get("content-range")) !== have) {
        await response.body?.cancel();
        await rm(partialPath, { force: true });
        throw new AppError(
          "UNAVAILABLE",
          "The server resumed from the wrong position. The partial file was discarded; download it again to start over.",
        );
      }
    } else if (response.status === 200) {
      // The server ignored the range and is sending everything again.
      if (have > 0) {
        have = 0;
        digest = new FileDigest(file);
        append = false;
        onBytes(0);
      }
    } else {
      await response.body?.cancel();
      throw describeStatus(response.status);
    }
    if (!response.body)
      throw new AppError("UNAVAILABLE", "The server sent no data.");
    options.onTransfer?.(have);

    let received = have;
    const output = createWriteStream(partialPath, {
      flags: append ? "a" : "w",
    });
    // Kept for the whole transfer: a write error must never surface as an
    // unhandled "error" event. It is rethrown by the next wait below.
    let writeError: Error | null = null;
    output.on("error", (error) => {
      writeError = error;
    });
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (received > file.sizeBytes) {
          throw new AppError(
            "INTEGRITY",
            "The server sent more data than the file should contain.",
          );
        }
        digest.update(chunk);
        // Respect backpressure so a fast network cannot buffer the file in memory.
        if (writeError) throw writeError;
        // events.once removes its listeners again, so waiting thousands of
        // times on a large file does not pile them up.
        if (!output.write(chunk)) await once(output, "drain");
        onBytes(received);
      }
    } catch (error) {
      await new Promise<void>((resolve) => output.end(resolve));
      if (signal.aborted) throw error;
      if (error instanceof AppError) {
        if (error.code === "INTEGRITY") await rm(partialPath, { force: true });
        throw error;
      }
      // The partial file stays, so a retry continues from here. The cause
      // is kept: "lost" can be the network, the disk or this process.
      const cause =
        error instanceof Error
          ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ""}`
          : String(error);
      throw new AppError(
        "UNAVAILABLE",
        `The connection was lost after ${megabytes(received)} of ${megabytes(file.sizeBytes)} (${cause}). Resume to continue from there.`,
      );
    }
    await new Promise<void>((resolve, reject) =>
      output.end((error?: Error | null) =>
        error || writeError ? reject(error ?? writeError) : resolve(),
      ),
    );
    have = received;
  }

  if (have !== file.sizeBytes) {
    throw new AppError(
      "UNAVAILABLE",
      `The transfer ended early, at ${megabytes(have)} of ${megabytes(file.sizeBytes)}. Resume to continue.`,
    );
  }
  if (!digest.matches()) {
    await rm(partialPath, { force: true });
    throw new AppError(
      "INTEGRITY",
      `${file.path} does not match its published ${digest.kind === "sha256" ? "SHA-256" : "Git hash"} and was deleted. Download it again to replace it.`,
    );
  }
  await rename(partialPath, finalPath);
}
