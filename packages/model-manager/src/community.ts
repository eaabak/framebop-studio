/**
 * Hugging Face as a second, community source of models.
 *
 * Searching and reading a repository use the Hub's public model API and
 * never download weights. A repository found this way is not assumed to be
 * runnable. It is checked against "recipes": descriptions of the file layout
 * that an engine in this build can load. Only a repository that matches one
 * can be added to the user's models, and then it is pinned to the commit
 * that was inspected, with the hashes the Hub reports, exactly like a
 * registry entry. No code from a repository is ever run, and no option that
 * would run it is offered.
 */
import { createHash } from "node:crypto";
import {
  AppError,
  type CatalogEntry,
  type GenerationCategory,
  type HubKit,
  type HubModelDetails,
  type HubSearchPage,
  type HubSearchResult,
  type ModelPart,
} from "@framebop/core";
import type { HubClient } from "./hub";

/** How the Hub's pipeline tags map onto the gallery's categories. */
const CATEGORY_OF_PIPELINE: Record<string, GenerationCategory> = {
  "text-to-image": "text-to-image",
  "image-to-image": "image-to-image",
  "text-to-video": "text-to-video",
  "image-to-video": "image-to-video",
  "text-to-speech": "text-to-speech",
  "text-to-audio": "audio",
  "audio-to-audio": "audio",
  "text-generation": "text-generation",
};

/** The pipeline tag to search with, for each category. */
export const PIPELINE_OF_CATEGORY: Partial<Record<GenerationCategory, string>> =
  {
    "text-to-image": "text-to-image",
    "image-to-image": "image-to-image",
    "text-to-video": "text-to-video",
    "image-to-video": "image-to-video",
    "text-to-speech": "text-to-speech",
    audio: "text-to-audio",
    "text-generation": "text-generation",
  };

export const HUB_PAGE_SIZE = 24;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function licenseFromTags(tags: readonly string[]): string | null {
  return (
    tags.find((tag) => tag.startsWith("license:"))?.slice("license:".length) ??
    null
  );
}

/** Reads one search result. Missing fields become null, never guesses. */
export function toSearchResult(raw: unknown): HubSearchResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record.id) ?? text(record.modelId);
  if (!id || !/^[\w.-]+\/[\w.-]+$/.test(id)) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const pipelineTag = text(record.pipeline_tag);
  return {
    id,
    author: text(record.author) ?? id.split("/")[0] ?? "",
    pipelineTag,
    category: pipelineTag
      ? (CATEGORY_OF_PIPELINE[pipelineTag] ?? "other")
      : null,
    likes: count(record.likes),
    downloads: count(record.downloads),
    license: licenseFromTags(tags),
    gated: record.gated !== undefined && record.gated !== false,
    tags,
    createdAt: text(record.createdAt),
  };
}

/** The cursor of the next page, from the Link URL the Hub sends. */
export function cursorOf(nextUrl: string | null): string | null {
  if (!nextUrl) return null;
  try {
    return new URL(nextUrl).searchParams.get("cursor");
  } catch {
    return null;
  }
}

export async function searchHub(
  hub: HubClient,
  options: {
    query: string;
    category: GenerationCategory | null;
    cursor: string | null;
    sort: "downloads" | "likes" | "trending" | "recent";
  },
  signal?: AbortSignal,
): Promise<HubSearchPage> {
  const params = new URLSearchParams({
    limit: String(HUB_PAGE_SIZE),
    sort:
      options.sort === "recent"
        ? "createdAt"
        : options.sort === "trending"
          ? "trendingScore"
          : options.sort,
    direction: "-1",
  });
  const query = options.query.trim();
  if (query) params.set("search", query.slice(0, 100));
  const pipeline = options.category
    ? PIPELINE_OF_CATEGORY[options.category]
    : undefined;
  if (pipeline) params.set("pipeline_tag", pipeline);
  if (options.cursor) params.set("cursor", options.cursor);

  const { body, next } = await hub.getJson(
    `/api/models?${params.toString()}`,
    signal,
  );
  if (!Array.isArray(body)) {
    throw new AppError(
      "UNAVAILABLE",
      "Hugging Face sent search results in an unexpected form.",
    );
  }
  return {
    results: body
      .map(toSearchResult)
      .filter((result): result is HubSearchResult => result !== null),
    nextCursor: cursorOf(next),
  };
}

interface HubFile {
  path: string;
  sizeBytes: number | null;
  sha256: string | null;
  blobId: string | null;
}

/**
 * A file layout that an engine in this build can load. `select` returns the
 * files to download when the repository matches, or null.
 */
interface Recipe {
  runtimeId: string;
  runtimeName: string;
  family: string;
  category: GenerationCategory;
  task: CatalogEntry["task"];
  format: CatalogEntry["format"];
  select(files: readonly HubFile[]): HubFile[] | null;
}

const RECIPES: readonly Recipe[] = [
  {
    // Kokoro-82M in its PyTorch release, as the kokoro package loads it.
    // Weights and voices are loaded with torch.load(weights_only=True),
    // which refuses pickled code.
    runtimeId: "kokoro-pytorch",
    runtimeName: "Kokoro (PyTorch, kokoro package)",
    family: "Kokoro",
    category: "text-to-speech",
    task: "audio",
    format: "pytorch",
    select(files) {
      const config = files.find((file) => file.path === "config.json");
      const weights = files.find((file) => file.path === "kokoro-v1_0.pth");
      // English voices: the ones this build can speak with.
      const voices = files.filter((file) =>
        /^voices\/[ab][fm]_[a-z0-9]+\.pt$/.test(file.path),
      );
      return config && weights && voices.length > 0
        ? [config, weights, ...voices]
        : null;
    },
  },
];

/** The runtime that runs kits: Framebop's own stable-diffusion.cpp. */
const KIT_RUNTIME = {
  id: "stable-diffusion.cpp",
  name: "stable-diffusion.cpp (installed by Framebop)",
};

type Role = ModelPart["role"];

/**
 * The role a weights file's folder or name suggests, in the layouts
 * ComfyUI-style and GGUF repositories use. Null for files no part takes
 * (LoRAs, audio encoders, files split into shards).
 */
export function guessRole(path: string): Role | null {
  const lower = path.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  if (!/\.(gguf|safetensors|sft|ckpt)$/.test(name)) return null;
  if (/-\d{5}-of-\d{5}\./.test(name)) return null;
  if (
    /(^|\/)(loras?|audio_encoders?|controlnet|upscale_models?|embeddings|model_patches)\//.test(
      lower,
    ) ||
    name.includes("lora")
  ) {
    return null;
  }
  if (lower.includes("clip_vision")) return "clip_vision";
  if (/(^|\/)vae\//.test(lower) || /(^|[_.-])(vae|ae)([_.-]|$)/.test(name)) {
    return "vae";
  }
  if (/umt5|t5xxl|t5_xxl|t5-xxl/.test(name)) return "t5xxl";
  if (name.includes("clip_l")) return "clip_l";
  if (name.includes("clip_g")) return "clip_g";
  if (
    /(^|\/)text_encoders?\//.test(lower) ||
    /qwen|mistral|llama|gemma/.test(name)
  ) {
    return "llm";
  }
  if (name.includes("high_noise")) return "high-noise-diffusion-model";
  if (/(^|\/)diffusion_models\//.test(lower) || name.endsWith(".gguf")) {
    return "diffusion-model";
  }
  return lower.includes("/") && !/(^|\/)checkpoints\//.test(lower)
    ? null
    : "model";
}

/** Prefers the usual 4-bit quantizations, then the smallest file. */
function preference(file: { path: string; sizeBytes: number }): number {
  const name = file.path.toLowerCase();
  const rank = /q4_k_m/.test(name)
    ? 0
    : /q4_k/.test(name)
      ? 1
      : /q4_0/.test(name)
        ? 2
        : 3;
  return rank * 1e15 + file.sizeBytes;
}

/** The weight files a kit can be made of, with a first choice per role. */
function kitCandidates(
  files: readonly HubFile[],
): HubModelDetails["support"]["candidates"] {
  const weights = files
    .filter(
      (file) =>
        file.sha256 !== null &&
        file.sizeBytes !== null &&
        /\.(gguf|safetensors|sft|ckpt)$/i.test(file.path),
    )
    .map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes ?? 0,
      role: guessRole(file.path),
      suggested: false,
    }));
  const pick = (role: Role) =>
    weights
      .filter((file) => file.role === role)
      .sort((a, b) => preference(a) - preference(b))[0];
  const diffusion = pick("diffusion-model");
  const chosen = diffusion
    ? [
        diffusion,
        pick("vae"),
        pick("t5xxl"),
        pick("llm"),
        pick("clip_l"),
        pick("clip_g"),
      ]
    : [pick("model")];
  for (const file of chosen) if (file) file.suggested = true;
  return weights;
}

function toFile(raw: unknown): HubFile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const path = text(record.rfilename);
  if (!path) return null;
  const lfs = record.lfs as { sha256?: unknown } | null | undefined;
  const sha256 = typeof lfs?.sha256 === "string" ? lfs.sha256 : null;
  return {
    path,
    sizeBytes: typeof record.size === "number" ? record.size : null,
    sha256,
    blobId: sha256 === null ? text(record.blobId) : null,
  };
}

/** Everything known about a repository, and whether Framebop can run it. */
export async function hubModelDetails(
  hub: HubClient,
  repoId: string,
  registry: readonly CatalogEntry[],
  signal?: AbortSignal,
): Promise<HubModelDetails & { recipeFiles: HubFile[] }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoId)) {
    throw new AppError(
      "VALIDATION",
      "That is not a Hugging Face repository name.",
    );
  }
  const { body } = await hub.getJson(
    `/api/models/${repoId}?blobs=true`,
    signal,
  );
  if (typeof body !== "object" || body === null) {
    throw new AppError("UNAVAILABLE", "Hugging Face sent no details.");
  }
  const record = body as Record<string, unknown>;
  const card = (record.cardData ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const files = (Array.isArray(record.siblings) ? record.siblings : [])
    .map(toFile)
    .filter((file): file is HubFile => file !== null);
  const sha = text(record.sha) ?? "";
  const pipelineTag = text(record.pipeline_tag);
  const gated = record.gated !== undefined && record.gated !== false;
  const license = text(card.license) ?? licenseFromTags(tags);
  const id = text(record.id) ?? repoId;

  const registryIds = registry
    .filter((entry) => entry.repoId === id)
    .map((entry) => entry.id);
  const recipe = RECIPES.map((candidate) => ({
    candidate,
    selected: candidate.select(files),
  })).find((match) => match.selected !== null);
  const selected = recipe?.selected ?? [];
  // Weights no recipe knows can still run once their parts are chosen.
  // Diffusers layouts (a model_index.json and sharded folders) are not
  // something sd-cli loads, so they are not offered as kits.
  const diffusers = files.some((file) => file.path === "model_index.json");
  const candidates = recipe || diffusers ? [] : kitCandidates(files);
  const kit = candidates.some((file) => file.role !== null);
  const kitTask =
    pipelineTag && /video/.test(pipelineTag)
      ? "image_to_video"
      : /wan|video|ltx|i2v|t2v/i.test(id)
        ? "image_to_video"
        : "image";
  const unknownSizes = selected.some((file) => file.sizeBytes === null);
  const unhashed = selected.some((file) => !file.sha256 && !file.blobId);

  let support: Omit<HubModelDetails["support"], "candidates" | "task">;
  if (registryIds.length > 0) {
    const onlyImported = registry
      .filter((entry) => entry.repoId === id)
      .every((entry) => entry.origin === "imported");
    support = {
      state: "registry",
      reason: onlyImported
        ? "You have already added this repository to your models."
        : "The Framebop registry already lists this repository.",
      registryIds,
      runtimeId: recipe?.candidate.runtimeId ?? null,
      selectedFiles: [],
      selectedBytes: 0,
    };
  } else if (!recipe && !kit) {
    support = {
      state: "unsupported",
      reason: "Model found, but no compatible Framebop runtime is available.",
      registryIds,
      runtimeId: null,
      selectedFiles: [],
      selectedBytes: 0,
    };
  } else if (gated) {
    support = {
      state: "unsupported",
      reason:
        "This repository is gated: it needs a Hugging Face account approved by the publisher. Signing in is not supported yet.",
      registryIds,
      runtimeId: recipe?.candidate.runtimeId ?? KIT_RUNTIME.id,
      selectedFiles: [],
      selectedBytes: 0,
    };
  } else if (!/^[0-9a-f]{40}$/.test(sha) || unknownSizes || unhashed) {
    support = {
      state: "unsupported",
      reason:
        "Hugging Face did not report a commit, sizes or hashes for every needed file, so the download could not be verified.",
      registryIds,
      runtimeId: recipe?.candidate.runtimeId ?? KIT_RUNTIME.id,
      selectedFiles: [],
      selectedBytes: 0,
    };
  } else if (!recipe) {
    const suggested = candidates.filter((file) => file.suggested);
    support = {
      state: "kit",
      reason:
        "stable-diffusion.cpp can run these weights once you choose which file does what: a diffusion model, its VAE and its text encoders.",
      registryIds,
      runtimeId: KIT_RUNTIME.id,
      selectedFiles: suggested.map((file) => file.path),
      selectedBytes: suggested.reduce((sum, file) => sum + file.sizeBytes, 0),
    };
  } else {
    support = {
      state: "importable",
      reason: `${recipe.candidate.runtimeName} can load this repository's files.`,
      registryIds,
      runtimeId: recipe.candidate.runtimeId,
      selectedFiles: selected.map((file) => file.path),
      selectedBytes: selected.reduce(
        (sum, file) => sum + (file.sizeBytes ?? 0),
        0,
      ),
    };
  }

  return {
    id,
    author: text(record.author) ?? id.split("/")[0] ?? "",
    sha,
    pipelineTag,
    category: pipelineTag
      ? (CATEGORY_OF_PIPELINE[pipelineTag] ?? "other")
      : null,
    library: text(record.library_name),
    license,
    licenseName: text(card.license_name),
    licenseLink: text(card.license_link),
    gated,
    downloads: count(record.downloads),
    likes: count(record.likes),
    lastModified: text(record.lastModified),
    url: `https://huggingface.co/${id}`,
    files: files.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    })),
    totalBytes: files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    support: {
      ...support,
      candidates: support.state === "kit" ? candidates : [],
      task: support.state === "kit" ? kitTask : null,
    },
    recipeFiles: selected,
  };
}

/** A stable, valid model id for an imported repository at one commit. */
export function importedModelId(repoId: string, sha: string): string {
  const slug = repoId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `hf-${slug}-${sha.slice(0, 8)}`;
}

/**
 * Builds the entry for an importable repository: pinned to the inspected
 * commit, with only the recipe's files and the hashes the Hub reported.
 */
export function entryFromHub(
  details: Awaited<ReturnType<typeof hubModelDetails>>,
  today: string,
): CatalogEntry {
  const recipe = RECIPES.find(
    (candidate) => candidate.runtimeId === details.support.runtimeId,
  );
  if (details.support.state !== "importable" || !recipe) {
    throw new AppError(
      "UNSUPPORTED",
      details.support.reason ||
        "Model found, but no compatible Framebop runtime is available.",
    );
  }
  const [, name = details.id] = details.id.split("/");
  const licenseUrl =
    details.licenseLink && /^https?:\/\//.test(details.licenseLink)
      ? details.licenseLink
      : details.url;
  return {
    id: importedModelId(details.id, details.sha),
    name: `${name} (imported)`,
    description: `Added from Hugging Face. ${details.support.reason} Files and hashes were read from the Hub at commit ${details.sha.slice(0, 12)}; not reviewed by the Framebop maintainers.`,
    source: "huggingface",
    repoId: details.id,
    revision: details.sha,
    family: recipe.family,
    task: recipe.task,
    variant: `commit ${details.sha.slice(0, 8)}`,
    quantization: null,
    format: recipe.format,
    files: details.recipeFiles.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes ?? 0,
      sha256: file.sha256,
      gitBlobId: file.sha256 ? null : file.blobId,
    })),
    runtime: { id: recipe.runtimeId, name: recipe.runtimeName },
    hardware: {
      accelerators: null,
      minimumMemoryBytes: null,
      source: null,
      notes: [
        "Imported from Hugging Face; no hardware requirements were reviewed.",
      ],
    },
    license: {
      id: details.license ?? "unknown",
      name: details.licenseName ?? details.license ?? "Not stated",
      url: licenseUrl,
      summary: details.license
        ? `As declared in the repository's metadata ("${details.license}"). Read the repository's licence before use.`
        : "The repository does not declare a licence. Do not assume you may use it.",
    },
    access: { gated: false, requirements: null },
    pageUrl: details.url,
    verifiedOn: today,
    provider: details.author,
    group: null,
    categories: [recipe.category],
    platforms: null,
    presets: [],
    parts: [],
    inferenceTests: [],
    llm: null,
    origin: "imported",
  };
}

/**
 * Builds the entry for the parts a user chose from a kit repository: only
 * those files, pinned to the inspected commit, each with its role. Shared
 * parts may name models already in the catalog.
 */
export function entryFromKit(
  details: HubModelDetails,
  kit: HubKit,
  catalogIds: ReadonlySet<string>,
  today: string,
): CatalogEntry {
  if (details.support.state !== "kit") {
    throw new AppError("UNSUPPORTED", details.support.reason);
  }
  const roles = kit.parts.map((part) => part.role);
  if (new Set(roles).size !== roles.length) {
    throw new AppError("VALIDATION", "Choose one file for each part.");
  }
  const main = kit.parts.find(
    (part) => part.role === "model" || part.role === "diffusion-model",
  );
  if (!main?.path) {
    throw new AppError(
      "VALIDATION",
      "Choose the model file itself (a diffusion model or a complete model).",
    );
  }
  const byPath = new Map(details.files.map((file) => [file.path, file]));
  const files: CatalogEntry["files"] = [];
  const parts: ModelPart[] = [];
  for (const part of kit.parts) {
    if ((part.path === undefined) === (part.model === undefined)) {
      throw new AppError(
        "VALIDATION",
        "Each part is either a file of this repository or one of your models.",
      );
    }
    if (part.model !== undefined) {
      if (!catalogIds.has(part.model)) {
        throw new AppError(
          "VALIDATION",
          `There is no model called “${part.model}”.`,
        );
      }
      parts.push({ role: part.role, model: part.model });
      continue;
    }
    const file = byPath.get(part.path ?? "");
    if (!file?.sha256 || file.sizeBytes === null) {
      throw new AppError(
        "VALIDATION",
        `${part.path} is not a file of this repository with a published hash.`,
      );
    }
    files.push({
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      gitBlobId: null,
    });
    parts.push({ role: part.role, file: file.path });
  }
  // Different choices from one repository are different models.
  const choice = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 8);
  const mainName = (main.path.split("/").pop() ?? main.path).replace(
    /\.[a-z0-9]+$/i,
    "",
  );
  const licenseUrl =
    details.licenseLink && /^https?:\/\//.test(details.licenseLink)
      ? details.licenseLink
      : details.url;
  return {
    id: `${importedModelId(details.id, details.sha).slice(0, 70)}-${choice}`,
    name: `${mainName} (imported)`,
    description: `Added from Hugging Face as a set of parts chosen by you, from ${details.id} at commit ${details.sha.slice(0, 12)}. Not reviewed by the Framebop maintainers.`,
    source: "huggingface",
    repoId: details.id,
    revision: details.sha,
    family: "Imported",
    task: kit.task,
    variant: `commit ${details.sha.slice(0, 8)}`,
    quantization: null,
    format: files.some((file) => file.path.endsWith(".gguf"))
      ? "gguf"
      : "safetensors",
    files,
    runtime: KIT_RUNTIME,
    hardware: {
      accelerators: null,
      minimumMemoryBytes: null,
      source: null,
      notes: [
        "Imported from Hugging Face; no hardware requirements were reviewed.",
      ],
    },
    license: {
      id: details.license ?? "unknown",
      name: details.licenseName ?? details.license ?? "Not stated",
      url: licenseUrl,
      summary: details.license
        ? `As declared in the repository's metadata ("${details.license}"). Read the repository's licence before use.`
        : "The repository does not declare a licence. Do not assume you may use it.",
    },
    access: { gated: false, requirements: null },
    pageUrl: details.url,
    verifiedOn: today,
    provider: details.author,
    group: null,
    categories:
      kit.task === "image"
        ? ["text-to-image"]
        : ["image-to-video", "text-to-video"],
    platforms: null,
    presets: [],
    parts,
    inferenceTests: [],
    llm: null,
    origin: "imported",
  };
}
