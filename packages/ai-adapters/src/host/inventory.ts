/**
 * Hardware inventory for model management.
 *
 * Every value here is read from the operating system or a vendor tool, or is
 * reported as unavailable with the reason. Nothing is inferred from a model
 * name: in particular, Apple Silicon has no separate VRAM figure and none is
 * made up, Windows does not imply NVIDIA, and Linux does not imply CUDA.
 *
 * The command output parsers are pure functions, so they can be tested with
 * recorded output from machines that are not available here.
 */
import { statfs } from "node:fs/promises";
import { availableParallelism, cpus, release, totalmem } from "node:os";
import type { Gpu, HardwareInventory, RuntimeStatus } from "@framebop/core";
import { runCommand } from "./exec";
import type { HostPlatform } from "./platform";
import { locateExecutable } from "./tools";

type Unavailable = HardwareInventory["unavailable"];

// --------------------------------------------------------------- macOS

/**
 * Parses `system_profiler SPDisplaysDataType -json`.
 *
 * Apple Silicon GPUs report a model, a core count and Metal support, but no
 * memory size, because they share system memory. Discrete GPUs in Intel Macs
 * report `spdisplays_vram`, a human string such as "8 GB".
 */
export function parseMacDisplays(json: string): Gpu[] {
  let report: { SPDisplaysDataType?: Record<string, unknown>[] };
  try {
    report = JSON.parse(json) as typeof report;
  } catch {
    return [];
  }
  return (report.SPDisplaysDataType ?? []).map((entry) => {
    const name =
      typeof entry.sppci_model === "string" ? entry.sppci_model : null;
    const vendorKey =
      typeof entry.spdisplays_vendor === "string"
        ? entry.spdisplays_vendor
        : "";
    const vendor =
      vendorKey
        .replace(/^sppci_vendor_/, "")
        .replace(/^spdisplays_vendor_/, "") || null;
    const metal = typeof entry.spdisplays_mtlgpufamilysupport === "string";
    const builtIn = entry.sppci_bus === "spdisplays_builtin";
    const vram =
      typeof entry.spdisplays_vram === "string" ? entry.spdisplays_vram : null;
    const cores =
      typeof entry.sppci_cores === "string" ? entry.sppci_cores : null;

    let memory: Gpu["memory"];
    if (vram) {
      memory = {
        kind: "dedicated",
        bytes: parseHumanBytes(vram),
        note: `Reported as ${vram}`,
      };
    } else if (builtIn && vendor === "Apple") {
      memory = {
        kind: "unified",
        bytes: null,
        note: "Shares system memory with the CPU; macOS reports no separate GPU memory.",
      };
    } else {
      memory = {
        kind: "unknown",
        bytes: null,
        note: "macOS did not report GPU memory.",
      };
    }
    return {
      name: cores && name ? `${name} (${cores}-core GPU)` : name,
      vendor,
      backend: metal ? "metal" : null,
      memory,
      source: "system_profiler SPDisplaysDataType",
    };
  });
}

/** "8 GB" → bytes, "1536 MB" → bytes; null when not a size. */
export function parseHumanBytes(text: string): number | null {
  const match = /^\s*([\d.]+)\s*(KB|MB|GB|TB)\s*$/i.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const power = { KB: 1, MB: 2, GB: 3, TB: 4 }[match[2].toUpperCase() as "KB"];
  return Math.round(Number(match[1]) * 1024 ** power);
}

// -------------------------------------------------------------- NVIDIA

/**
 * Parses `nvidia-smi --query-gpu=name,memory.total,driver_version
 * --format=csv,noheader,nounits`. Memory is in MiB.
 */
export function parseNvidiaSmi(csv: string): {
  gpus: Gpu[];
  driver: string | null;
} {
  let driver: string | null = null;
  const gpus = csv
    .split(/\r?\n/)
    .map((line) => line.split(",").map((part) => part.trim()))
    .filter((parts) => parts.length >= 3 && parts[0])
    .map(([name, memory, version]): Gpu => {
      driver = version ?? driver;
      const mib = Number(memory);
      return {
        name: name ?? null,
        vendor: "NVIDIA",
        backend: "cuda",
        memory: Number.isFinite(mib)
          ? { kind: "dedicated", bytes: mib * 1024 * 1024, note: null }
          : {
              kind: "unknown",
              bytes: null,
              note: "nvidia-smi gave no memory size.",
            },
        source: "nvidia-smi",
      };
    });
  return { gpus, driver };
}

// ------------------------------------------------------------- Windows

/**
 * Parses `Get-CimInstance Win32_VideoController | Select-Object Name,
 * AdapterCompatibility | ConvertTo-Json`. A single adapter arrives as an
 * object rather than an array.
 *
 * AdapterRAM is deliberately not used: it is a 32-bit field that cannot
 * represent more than 4 GB, so it is wrong for most modern GPUs.
 */
export function parseWindowsVideoControllers(json: string): Gpu[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]) as Record<
    string,
    unknown
  >[];
  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.Name === "string" ? entry.Name : null,
      vendor:
        typeof entry.AdapterCompatibility === "string"
          ? entry.AdapterCompatibility
          : null,
      backend: null,
      memory: {
        kind: "unknown",
        bytes: null,
        note: "Windows' video controller report cannot represent more than 4 GB, so it is not used.",
      },
      source: "Win32_VideoController",
    }));
}

// --------------------------------------------------------------- Linux

/** Parses `lspci -mm`, keeping display controllers. */
export function parseLspci(text: string): Gpu[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? ""),
    )
    .filter(
      (fields) =>
        fields.length >= 3 &&
        /VGA compatible controller|3D controller|Display controller/i.test(
          fields[0] ?? "",
        ),
    )
    .map((fields) => ({
      name: fields[2] || null,
      vendor: fields[1] || null,
      backend: null,
      memory: {
        kind: "unknown",
        bytes: null,
        note: "lspci does not report GPU memory.",
      },
      source: "lspci",
    }));
}

// ------------------------------------------------------------ assembly

async function readGpus(
  host: HostPlatform,
  env: NodeJS.ProcessEnv,
  unavailable: Unavailable,
): Promise<{ gpus: Gpu[]; nvidiaDriver: string | null }> {
  // NVIDIA's own tool is the only reliable source of VRAM on Windows and Linux.
  const nvidiaSmi = await locateExecutable(host, "nvidia-smi", env);
  if (nvidiaSmi) {
    const result = await runCommand(nvidiaSmi, [
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader,nounits",
    ]);
    if (result.ok) {
      const parsed = parseNvidiaSmi(result.stdout);
      if (parsed.gpus.length > 0)
        return { gpus: parsed.gpus, nvidiaDriver: parsed.driver };
    }
  }

  if (host.os === "macos") {
    const result = await runCommand(
      "/usr/sbin/system_profiler",
      ["SPDisplaysDataType", "-json"],
      { timeoutMs: 20_000 },
    );
    if (result.ok)
      return { gpus: parseMacDisplays(result.stdout), nvidiaDriver: null };
  } else if (host.os === "windows") {
    const result = await runCommand(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility | ConvertTo-Json",
      ],
      { timeoutMs: 20_000 },
    );
    if (result.ok)
      return {
        gpus: parseWindowsVideoControllers(result.stdout),
        nvidiaDriver: null,
      };
  } else if (host.os === "linux") {
    const lspci = await locateExecutable(host, "lspci", env);
    if (lspci) {
      const result = await runCommand(lspci, ["-mm"]);
      if (result.ok)
        return { gpus: parseLspci(result.stdout), nvidiaDriver: null };
    }
  }
  unavailable.push({
    field: "GPU",
    reason: "No GPU information could be read on this system.",
  });
  return { gpus: [], nvidiaDriver: null };
}

async function readOsVersion(host: HostPlatform): Promise<string | null> {
  if (host.os === "macos") {
    const result = await runCommand("/usr/bin/sw_vers", ["-productVersion"]);
    if (result.ok && result.stdout.trim()) return result.stdout.trim();
  }
  // Elsewhere the kernel release is what Node can report reliably.
  return release() || null;
}

function runtimesFor(
  host: HostPlatform,
  gpus: readonly Gpu[],
  nvidiaDriver: string | null,
  rocmPresent: boolean,
): RuntimeStatus[] {
  const metal = gpus.some((gpu) => gpu.backend === "metal");
  return [
    {
      id: "cpu",
      name: "CPU",
      available: true,
      version: null,
      detail: "Always available. Slow for large models.",
    },
    {
      id: "apple-metal",
      name: "Metal",
      available: metal,
      version: null,
      detail: metal
        ? "The GPU reports Metal support."
        : host.os === "macos"
          ? "No Metal-capable GPU was reported."
          : "Metal exists only on Apple platforms.",
    },
    {
      id: "cuda",
      name: "CUDA (NVIDIA)",
      available: nvidiaDriver !== null,
      version: nvidiaDriver ? `driver ${nvidiaDriver}` : null,
      detail: nvidiaDriver
        ? "nvidia-smi reports a working NVIDIA driver."
        : "No NVIDIA driver was found (nvidia-smi is not available).",
    },
    {
      id: "rocm",
      name: "ROCm (AMD)",
      available: rocmPresent,
      version: null,
      detail: rocmPresent
        ? "rocm-smi is installed. Whether a given model runs on it is not checked."
        : "No ROCm installation was found (rocm-smi is not available).",
    },
  ];
}

/**
 * Inspects the machine. `storagePath` is the folder whose free space matters,
 * normally where models are stored.
 */
export async function inspectHardware(
  host: HostPlatform,
  options: { env: NodeJS.ProcessEnv; storagePath: string },
): Promise<HardwareInventory> {
  const unavailable: Unavailable = [];
  const [{ gpus, nvidiaDriver }, osVersion, rocm, space] = await Promise.all([
    readGpus(host, options.env, unavailable),
    readOsVersion(host),
    locateExecutable(host, "rocm-smi", options.env),
    statfs(options.storagePath).catch(() => null),
  ]);

  for (const gpu of gpus) {
    if (gpu.memory.kind === "unknown") {
      unavailable.push({
        field: `GPU memory (${gpu.name ?? "unnamed GPU"})`,
        reason: gpu.memory.note ?? "Not reported.",
      });
    }
  }
  if (space === null) {
    unavailable.push({
      field: "Free storage",
      reason: `The free space of ${options.storagePath} could not be read.`,
    });
  }

  return {
    os: host.os,
    osVersion,
    arch: host.arch,
    cpu: {
      model: cpus()[0]?.model.trim() || "Unknown CPU",
      cores: availableParallelism(),
    },
    memory: { totalBytes: totalmem() },
    gpus,
    storage: {
      path: options.storagePath,
      availableBytes: space ? space.bavail * space.bsize : null,
      totalBytes: space ? space.blocks * space.bsize : null,
    },
    runtimes: runtimesFor(host, gpus, nvidiaDriver, rocm !== null),
    unavailable,
    detectedAt: new Date().toISOString(),
  };
}
