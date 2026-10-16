import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { AppError } from "@framebop/core";

/** Libraries this process has open, to catch a double open in one process. */
const heldByThisProcess = new Set<string>();

function isRunning(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only reports whether the process exists.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Claims a library for this process and returns a function that releases it.
 *
 * One engine per library is a hard requirement, not a nicety. At startup the
 * engine marks every job it finds "running" as interrupted, on the reasoning
 * that the process that ran it is gone. A second engine opening the same
 * library would therefore declare the first engine's live jobs dead.
 *
 * The lock is a small file holding the owner's process id. A lock whose
 * owner no longer exists is stale (the owner crashed) and is taken over.
 */
export function acquireLibraryLock(lockPath: string): () => void {
  if (heldByThisProcess.has(lockPath)) {
    throw new AppError("CONFLICT", "This library is already open.");
  }
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: unknown;
    };
    if (
      typeof owner.pid === "number" &&
      owner.pid !== process.pid &&
      isRunning(owner.pid)
    ) {
      throw new AppError(
        "CONFLICT",
        `This library is in use by another Framebop Studio process (${owner.pid}). Close that one first.`,
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // No lock file, or an unreadable one: nobody holds the library.
  }

  writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, since: new Date().toISOString() }),
  );
  heldByThisProcess.add(lockPath);

  return () => {
    if (!heldByThisProcess.delete(lockPath)) return;
    rmSync(lockPath, { force: true });
  };
}
