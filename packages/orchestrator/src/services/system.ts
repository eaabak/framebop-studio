import { release } from "node:os";
import {
  type AdapterRegistry,
  type HostPlatform,
  describeEngines,
  detectHardware,
  probeFfmpegTool,
} from "@framebop/ai-adapters";
import type { EngineStatus, SystemInfo } from "@framebop/core";
import type { DetectedTools, EngineContext } from "../context";
import { preferredLanguages } from "./languages";

// Replaced with the workspace version by the bundler (see build.mjs).
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";

export async function detectTools(
  host: HostPlatform,
  env: NodeJS.ProcessEnv,
): Promise<DetectedTools> {
  const [ffmpeg, ffprobe] = await Promise.all([
    probeFfmpegTool(host, "ffmpeg", env),
    probeFfmpegTool(host, "ffprobe", env),
  ]);
  return { ffmpeg, ffprobe };
}

export async function getSystemInfo(ctx: EngineContext): Promise<SystemInfo> {
  return {
    appVersion: APP_VERSION,
    preferredLanguages: await preferredLanguages(ctx.host.os, ctx.env),
    schemaVersion: ctx.db.schemaVersion,
    dataDir: ctx.paths.dataDir,
    mediaRoot: ctx.paths.mediaRoot,
    databasePath: ctx.paths.databasePath,
    logFile: ctx.paths.logFile,
    platform: ctx.host.os,
    arch: ctx.host.arch,
    osRelease: release(),
    runtimeVersion: process.version,
    hardware: detectHardware(ctx.host),
    tools: ctx.tools,
  };
}

/** Rescans the machine, so installing a tool is picked up without a restart. */
export async function listEngines(
  ctx: EngineContext,
  registry: AdapterRegistry,
): Promise<EngineStatus[]> {
  ctx.tools = await detectTools(ctx.host, ctx.env);
  return describeEngines(registry, ctx.tools);
}
