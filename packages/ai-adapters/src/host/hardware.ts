import { availableParallelism, cpus, totalmem } from "node:os";
import type { SystemInfo } from "@framebop/core";
import type { HostPlatform } from "./platform";

export type HardwareProfile = SystemInfo["hardware"];

/**
 * Describes the machine for display and, later, model compatibility checks.
 *
 * Only Apple Silicon is classified so far: its GPU shares system memory, so
 * total memory is the relevant budget. Discrete GPU and VRAM detection for
 * Windows and Linux is not implemented, and is reported as "unknown" rather
 * than guessed.
 */
export function detectHardware(host: HostPlatform): HardwareProfile {
  const processors = cpus();
  return {
    cpuModel: processors[0]?.model.trim() || "Unknown CPU",
    cpuCores: availableParallelism(),
    totalMemoryBytes: totalmem(),
    accelerator:
      host.os === "macos" && host.arch === "arm64" ? "apple-metal" : "unknown",
  };
}
