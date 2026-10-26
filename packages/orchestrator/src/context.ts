import type { HostPlatform } from "@framebop/ai-adapters";
import type { CoreEvent, ToolStatus } from "@framebop/core";
import type { LibraryDatabase } from "@framebop/database";
import type { Logger } from "./logger";
import type { LibraryPaths } from "./paths";

export interface DetectedTools {
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
}

/** Shared dependencies handed to every service. Built once per engine. */
export interface EngineContext {
  readonly db: LibraryDatabase;
  readonly paths: LibraryPaths;
  readonly log: Logger;
  readonly host: HostPlatform;
  readonly env: NodeJS.ProcessEnv;
  /** Last detected state of optional external tools. Replaced on rescan. */
  tools: DetectedTools;
  /** External model calls (writer/director/voice preview) hold the production lane. */
  modelBusy?: () => boolean;
  emit(event: CoreEvent): void;
  now(): string;
  newId(): string;
}
