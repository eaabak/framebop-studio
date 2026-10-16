import { type Hash, createHash } from "node:crypto";
import type { ModelFile } from "@framebop/core";

/**
 * Computes the digest a file is published with, incrementally.
 *
 * Large files are stored in Git LFS and identified by the SHA-256 of their
 * content. Small files are plain Git blobs, identified by Git's object id:
 * SHA-1 over a "blob <size>\0" header followed by the content.
 */
export class FileDigest {
  private readonly hash: Hash;
  readonly expected: string;
  readonly kind: "sha256" | "git-blob";

  constructor(file: Pick<ModelFile, "sha256" | "gitBlobId" | "sizeBytes">) {
    if (file.sha256) {
      this.kind = "sha256";
      this.expected = file.sha256;
      this.hash = createHash("sha256");
    } else if (file.gitBlobId) {
      this.kind = "git-blob";
      this.expected = file.gitBlobId;
      this.hash = createHash("sha1");
      this.hash.update(`blob ${file.sizeBytes}\0`);
    } else {
      throw new Error("A file without a published hash cannot be verified.");
    }
  }

  update(chunk: Uint8Array): void {
    this.hash.update(chunk);
  }

  /** True when the content seen so far matches the published digest. */
  matches(): boolean {
    return this.hash.digest("hex") === this.expected;
  }
}
