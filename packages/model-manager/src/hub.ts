/**
 * A small client for the Hugging Face Hub's HTTP API.
 *
 * The official @huggingface/hub package was evaluated and not used for
 * downloads: its cache download writes a whole file without reporting
 * progress, cannot resume an interrupted transfer, and does not verify the
 * result. Two documented endpoints are enough to do all three properly:
 *
 *   GET {endpoint}/api/models/{repo}/revision/{commit}?blobs=true
 *       the file list with sizes and hashes at an exact commit
 *   GET {endpoint}/{repo}/resolve/{commit}/{path}
 *       the file itself; supports HTTP range requests, including for files
 *       served through Hugging Face's Xet storage
 *
 * The endpoint is configurable so tests can point it at a local server.
 */
import { AppError, type ModelFile } from "@framebop/core";

export const HUGGING_FACE = "https://huggingface.co";

export interface RemoteFile {
  path: string;
  sizeBytes: number | null;
  sha256: string | null;
  gitBlobId: string | null;
}

export interface RemoteRevision {
  commit: string;
  gated: boolean;
  files: Map<string, RemoteFile>;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class HubClient {
  constructor(
    readonly endpoint: string = HUGGING_FACE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Repository metadata at one exact commit. */
  async revision(
    repoId: string,
    commit: string,
    signal?: AbortSignal,
  ): Promise<RemoteRevision> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.endpoint}/api/models/${repoId}/revision/${commit}?blobs=true`,
        { signal },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AppError(
        "UNAVAILABLE",
        `Hugging Face could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "UNAVAILABLE",
        "Hugging Face refused access to this repository. It may be gated or private.",
      );
    }
    if (response.status === 404) {
      throw new AppError(
        "NOT_FOUND",
        `The repository ${repoId} or commit ${commit} was not found.`,
      );
    }
    if (!response.ok) {
      throw new AppError(
        "UNAVAILABLE",
        `Hugging Face answered with status ${response.status}.`,
      );
    }
    const body = (await response.json()) as {
      sha?: unknown;
      gated?: unknown;
      siblings?: {
        rfilename?: unknown;
        size?: unknown;
        blobId?: unknown;
        lfs?: { sha256?: unknown } | null;
      }[];
    };
    const files = new Map<string, RemoteFile>();
    for (const sibling of body.siblings ?? []) {
      if (typeof sibling.rfilename !== "string") continue;
      const lfs =
        typeof sibling.lfs?.sha256 === "string" ? sibling.lfs.sha256 : null;
      files.set(sibling.rfilename, {
        path: sibling.rfilename,
        sizeBytes: typeof sibling.size === "number" ? sibling.size : null,
        sha256: lfs,
        // A blob id identifies the file itself only when it is not in LFS.
        gitBlobId:
          lfs === null && typeof sibling.blobId === "string"
            ? sibling.blobId
            : null,
      });
    }
    return {
      commit: typeof body.sha === "string" ? body.sha : commit,
      gated:
        body.gated !== false && body.gated !== undefined && body.gated !== null,
      files,
    };
  }

  fileUrl(repoId: string, commit: string, path: string): string {
    return `${this.endpoint}/${repoId}/resolve/${commit}/${encodePath(path)}`;
  }

  /**
   * One page of the Hub's model search, newest cursor first. `path` is a
   * relative API path with its query; the next page's comes back in the
   * response's Link header.
   */
  async getJson(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ body: unknown; next: string | null }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}${path}`, {
        signal,
        headers: { accept: "application/json" },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AppError(
        "UNAVAILABLE",
        "Hugging Face could not be reached. You may be offline; the Framebop registry and installed models still work.",
      );
    }
    if (response.status === 429) {
      await response.body?.cancel();
      // "api";r=0;t=85 — the window resets in t seconds.
      const reset = /t=(\d+)/.exec(response.headers.get("ratelimit") ?? "");
      throw new AppError(
        "UNAVAILABLE",
        `Hugging Face is limiting requests from this computer. Try again in ${reset?.[1] ?? "a few"} seconds.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new AppError(
        "UNAVAILABLE",
        "Hugging Face refused access. The repository may be gated or private.",
      );
    }
    if (response.status === 404) {
      await response.body?.cancel();
      throw new AppError("NOT_FOUND", "Hugging Face has no such repository.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "UNAVAILABLE",
        `Hugging Face answered with status ${response.status}.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AppError(
        "UNAVAILABLE",
        "Hugging Face sent an answer that is not valid JSON.",
      );
    }
    const link = response.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
    return { body, next };
  }
}

/**
 * Confirms that the catalog's file list still matches the hub before any
 * byte is downloaded, so a stale or mistyped catalog entry fails with a
 * clear message instead of a hash mismatch half way through.
 */
export function checkAgainstRevision(
  files: readonly ModelFile[],
  remote: RemoteRevision,
  commit: string,
): void {
  if (remote.commit !== commit) {
    throw new AppError(
      "CONFLICT",
      `Hugging Face resolved the pinned commit to ${remote.commit}, not ${commit}.`,
    );
  }
  for (const file of files) {
    const found = remote.files.get(file.path);
    if (!found) {
      throw new AppError(
        "NOT_FOUND",
        `${file.path} is missing from the repository at this commit.`,
      );
    }
    const sameHash =
      (file.sha256 !== null && found.sha256 === file.sha256) ||
      (file.gitBlobId !== null && found.gitBlobId === file.gitBlobId);
    if (
      !sameHash ||
      (found.sizeBytes !== null && found.sizeBytes !== file.sizeBytes)
    ) {
      throw new AppError(
        "CONFLICT",
        `${file.path} on Hugging Face no longer matches the catalog. The catalog entry needs updating.`,
      );
    }
  }
}
