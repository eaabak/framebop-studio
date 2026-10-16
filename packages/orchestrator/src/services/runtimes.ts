/**
 * Runtimes Framebop installs and runs itself, so that no other application
 * has to be installed or opened: stable-diffusion.cpp, the image engine,
 * sherpa-onnx, the voice engine, with one voice pack per language, and
 * llama.cpp's server, which runs the local language models.
 *
 * A runtime is a pinned upstream build: one exact release, its download
 * address and its SHA-256. It is downloaded only when the user agrees,
 * checked against that hash before anything is unpacked, and installed in
 * the library's own runtimes folder, next to a record of what it is.
 * Packaging it with the installers is for a later phase.
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { chmod, mkdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type VoicePackDescriptor,
  runCommand,
  speaksLanguage,
} from "@framebop/ai-adapters";
import {
  AppError,
  type ImageRuntimeStatus,
  type VoiceSetupStatus,
} from "@framebop/core";
import type { EngineContext } from "../context";

/** stable-diffusion.cpp, MIT licence, built by its own release workflow. */
export const SD_CPP_BUILD = {
  version: "master-929-3f8527a",
  executable: "sd-cli",
  builds: {
    "darwin-arm64": {
      url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-929-3f8527a/sd-master-3f8527a-bin-Darwin-macOS-26.6.2-arm64.zip",
      sha256:
        "1c8ee6c8e413e3335b1223bbc657ea5d86dae1819f8426a98b84c265587eb192",
      sizeBytes: 35_049_086,
    },
  } as Record<string, { url: string; sha256: string; sizeBytes: number }>,
};

const MARKER = "framebop-runtime.json";

/**
 * Downloads a pinned file and checks its size and SHA-256 before it is used.
 * Returns the hash; throws, leaving nothing usable, when it does not match.
 */
async function downloadPinned(
  pin: { url: string; sha256: string; sizeBytes: number },
  file: string,
  onBytes?: (done: number) => void,
): Promise<string> {
  const response = await fetch(pin.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new AppError(
      "UNAVAILABLE",
      `The download failed (HTTP ${response.status}).`,
    );
  }
  const hash = createHash("sha256");
  let size = 0;
  const counted = Readable.fromWeb(response.body as never).on(
    "data",
    (chunk: Buffer) => {
      hash.update(chunk);
      size += chunk.length;
      onBytes?.(size);
    },
  );
  await pipeline(counted, createWriteStream(file));
  const digest = hash.digest("hex");
  if (size !== pin.sizeBytes || digest !== pin.sha256) {
    throw new AppError(
      "ENGINE_FAILURE",
      "The download does not match its published hash, so it was not installed.",
    );
  }
  return digest;
}

/** Unpacks a `.tar.*`, dropping its top folder; `tar` ships with macOS. */
async function untar(
  archive: string,
  destination: string,
  members: string[] = [],
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const result = await runCommand(
    "/usr/bin/tar",
    ["-xf", archive, "-C", destination, "--strip-components", "1", ...members],
    { timeoutMs: 300_000 },
  );
  if (!result.ok) {
    throw new AppError(
      "ENGINE_FAILURE",
      `The download could not be unpacked: ${result.stderr}`,
    );
  }
}

function readInstalledAt(directory: string): string | null {
  try {
    const record = JSON.parse(
      readFileSync(join(directory, MARKER), "utf8"),
    ) as { installedAt?: string };
    return record.installedAt ?? null;
  } catch {
    return null;
  }
}

/** Bytes in a folder's files, without following links. */
function folderBytes(directory: string): number {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += folderBytes(path);
    else if (entry.isFile()) total += lstatSync(path).size;
  }
  return total;
}

/** Sizes are measured once per installation; status is polled. */
const measured = new Map<string, { installedAt: string; bytes: number }>();

function installedBytes(directory: string): number | null {
  const installedAt = readInstalledAt(directory);
  if (installedAt === null) return null;
  const known = measured.get(directory);
  if (known?.installedAt === installedAt) return known.bytes;
  try {
    const bytes = folderBytes(directory);
    measured.set(directory, { installedAt, bytes });
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Deletes a folder Framebop installed. Only a real folder (not a link) that
 * holds Framebop's record and lies inside the library's `area` folder is
 * touched; anything else is refused and left as it is. Returns the bytes
 * freed, or null when nothing was installed there.
 */
async function removeInstalled(
  ctx: EngineContext,
  area: "runtimes" | "voices",
  directory: string,
): Promise<number | null> {
  if (!existsSync(directory)) return null;
  const root = join(ctx.paths.dataDir, area);
  const inside = relative(realpathSync(root), realpathSync(directory));
  const marker = join(directory, MARKER);
  if (
    !lstatSync(directory).isDirectory() ||
    inside === "" ||
    inside.startsWith("..") ||
    isAbsolute(inside) ||
    !existsSync(marker) ||
    !lstatSync(marker).isFile()
  ) {
    throw new AppError(
      "CONFLICT",
      "That folder was not installed by Framebop, so it was left as it is.",
    );
  }
  const bytes = folderBytes(directory);
  await rm(directory, { recursive: true, force: true });
  measured.delete(directory);
  // A runtime's own folder, such as runtimes/llama.cpp, goes once it is empty.
  if (dirname(directory) !== root) {
    await rmdir(dirname(directory)).catch(() => {});
  }
  return bytes;
}

export class ImageRuntimeService {
  private installing = false;

  constructor(
    private readonly ctx: EngineContext,
    /** Where the build is downloaded from; tests point it elsewhere. */
    private readonly source: typeof SD_CPP_BUILD = SD_CPP_BUILD,
  ) {}

  private get build() {
    return this.source.builds[`${process.platform}-${process.arch}`] ?? null;
  }

  directory(): string {
    return join(
      this.ctx.paths.dataDir,
      "runtimes",
      "stable-diffusion.cpp",
      this.source.version,
    );
  }

  /** The installed program, for the adapter; read whenever it is needed. */
  locate(): {
    path: string | null;
    version: string | null;
    reason: string | null;
  } {
    const directory = this.directory();
    const program = join(directory, this.source.executable);
    if (existsSync(join(directory, MARKER)) && existsSync(program)) {
      return { path: program, version: this.source.version, reason: null };
    }
    return {
      path: null,
      version: null,
      reason:
        this.build === null
          ? "Framebop's image runtime has no build for this computer yet."
          : "Framebop's image runtime is not installed yet.",
    };
  }

  status(): ImageRuntimeStatus {
    const located = this.locate();
    const installedAt = located.path ? readInstalledAt(this.directory()) : null;
    return {
      name: "stable-diffusion.cpp",
      version: this.source.version,
      license: "MIT",
      state: this.installing
        ? "installing"
        : located.path
          ? "installed"
          : this.build === null
            ? "unsupported"
            : "not-installed",
      downloadBytes: this.build?.sizeBytes ?? null,
      installedBytes: located.path ? installedBytes(this.directory()) : null,
      path: located.path,
      installedAt,
    };
  }

  /** Deletes the installed build. Only with consent; not while installing. */
  async remove(): Promise<ImageRuntimeStatus> {
    if (this.installing) {
      throw new AppError(
        "CONFLICT",
        "The image runtime is being installed. Wait for it to finish first.",
      );
    }
    const freed = await removeInstalled(this.ctx, "runtimes", this.directory());
    if (freed !== null) {
      this.ctx.log.scope("runtimes").info("Removed the image runtime", {
        version: this.source.version,
        bytes: freed,
      });
    }
    return this.status();
  }

  /** Downloads, checks and unpacks the pinned build. Only with consent. */
  async install(): Promise<ImageRuntimeStatus> {
    const build = this.build;
    if (build === null) {
      throw new AppError(
        "UNSUPPORTED",
        "There is no runtime build for this computer yet.",
      );
    }
    if (this.installing) {
      throw new AppError(
        "CONFLICT",
        "The image runtime is already being installed.",
      );
    }
    if (this.locate().path) return this.status();
    this.installing = true;
    const work = join(this.ctx.paths.workRoot, `runtime-${this.ctx.newId()}`);
    const staging = `${this.directory()}.partial`;
    try {
      await mkdir(work, { recursive: true });
      const archive = join(work, "runtime.zip");
      const digest = await downloadPinned(build, archive);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      // `ditto` ships with macOS, the one platform with a pinned build.
      const unpacked = await runCommand(
        "/usr/bin/ditto",
        ["-x", "-k", archive, staging],
        {
          timeoutMs: 120_000,
        },
      );
      if (!unpacked.ok) {
        throw new AppError(
          "ENGINE_FAILURE",
          `The runtime could not be unpacked: ${unpacked.stderr}`,
        );
      }
      const program = join(staging, this.source.executable);
      if (!existsSync(program)) {
        throw new AppError(
          "ENGINE_FAILURE",
          "The runtime archive has no sd-cli program.",
        );
      }
      await chmod(program, 0o755);
      await writeFile(
        join(staging, MARKER),
        JSON.stringify(
          {
            name: "stable-diffusion.cpp",
            version: this.source.version,
            sha256: digest,
            source: build.url,
            installedAt: this.ctx.now(),
          },
          null,
          2,
        ),
      );
      await rm(this.directory(), { recursive: true, force: true });
      await rename(staging, this.directory());
      this.ctx.log.scope("runtimes").info("Installed the image runtime", {
        version: this.source.version,
      });
    } finally {
      this.installing = false;
      await rm(work, { recursive: true, force: true });
      await rm(staging, { recursive: true, force: true });
    }
    return this.status();
  }
}

/** sherpa-onnx, Apache 2.0 licence, built by its own release workflow. */
export const SHERPA_ONNX_BUILD = {
  version: "1.13.8",
  executable: "bin/sherpa-onnx-offline-tts",
  /** Only the TTS program and its libraries are kept from the archive. */
  members: [
    "sherpa-onnx-v1.13.8-osx-arm64-shared/bin/sherpa-onnx-offline-tts",
    "sherpa-onnx-v1.13.8-osx-arm64-shared/lib",
  ],
  builds: {
    "darwin-arm64": {
      url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-arm64-shared.tar.bz2",
      sha256:
        "b10e5c7e2c30ea03de9c442655d14860d9edc475c6251d58a8f5f06e913a1d56",
      sizeBytes: 20_314_448,
    },
  } as Record<string, { url: string; sha256: string; sizeBytes: number }>,
};

/** A pinned voice pack, as published with sherpa-onnx's TTS models. */
export interface VoicePackPin extends Omit<VoicePackDescriptor, "directory"> {
  url: string;
  sha256: string;
  sizeBytes: number;
  license: string;
}

const TTS_MODELS =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

/** Piper voices trained on public-domain (CC0) recordings. */
function piper(
  language: string,
  languageName: string,
  name: string,
  gender: "female" | "male",
  file: string,
  sha256: string,
  sizeBytes: number,
): VoicePackPin {
  return {
    id: `${language.toLowerCase()}-${name.toLowerCase()}`,
    name: `${name} (${languageName})`,
    language,
    languageName,
    family: "piper",
    model: `${file}.onnx`,
    voices: [{ id: name.toLowerCase(), name, gender }],
    url: `${TTS_MODELS}/vits-piper-${file}.tar.bz2`,
    sha256,
    sizeBytes,
    license: "Piper voice (MIT), recordings CC0",
  };
}

/** One voice pack per language Framebop's interface speaks. */
export const VOICE_PACKS: VoicePackPin[] = [
  {
    id: "en-kokoro",
    name: "Kokoro (English)",
    language: "en",
    languageName: "English",
    family: "kokoro",
    model: "model.int8.onnx",
    // Speaker-id order of Kokoro v0.19.
    voices: [
      ["af", "Nova", "female"],
      ["af_bella", "Bella", "female"],
      ["af_nicole", "Nicole", "female"],
      ["af_sarah", "Sarah", "female"],
      ["af_sky", "Sky", "female"],
      ["am_adam", "Adam", "male"],
      ["am_michael", "Michael", "male"],
      ["bf_emma", "Emma (British)", "female"],
      ["bf_isabella", "Isabella (British)", "female"],
      ["bm_george", "George (British)", "male"],
      ["bm_lewis", "Lewis (British)", "male"],
    ].map(([id, name, gender]) => ({
      id: id as string,
      name: name as string,
      gender: gender as "female" | "male",
    })),
    url: `${TTS_MODELS}/kokoro-int8-en-v0_19.tar.bz2`,
    sha256: "c9f0dd393615805b0bab050c340834d5e684e732aec91c0e860cd30e982c08bd",
    sizeBytes: 103_248_205,
    license: "Apache 2.0",
  },
  piper(
    "tr",
    "Turkish",
    "Fahrettin",
    "male",
    "tr_TR-fahrettin-medium",
    "2ee3c18b5dc0a5faf913f995b027163befa6e7a6ad2f5c6b8a2e99fe1aad8b6d",
    67_212_827,
  ),
  piper(
    "de",
    "German",
    "Thorsten",
    "male",
    "de_DE-thorsten-medium",
    "50487d9c95fdf2191f31d2588569381063ba1591dcd4c7d4bdd30f12b2191714",
    67_214_254,
  ),
  piper(
    "es",
    "Spanish",
    "Davefx",
    "male",
    "es_ES-davefx-medium",
    "a3f6beb54a9cb893279f72978a22f807a4d9fc9c7848157b524d5cc7b7f58b22",
    67_184_952,
  ),
  piper(
    "pt-BR",
    "Brazilian Portuguese",
    "Faber",
    "male",
    "pt_BR-faber-medium",
    "7add3f923ad6bc25ca8a192805fd1a64d1b3893e4611c4a9719545a825039a83",
    67_183_065,
  ),
];

/**
 * Framebop's voice engine: the sherpa-onnx TTS program and its voice packs.
 * Installing for a language fetches the program if needed, then that
 * language's pack, in the background; the status says how far it is.
 */
export class VoiceRuntimeService {
  private task: { language: string; done: number; total: number } | null = null;
  private failure: string | null = null;

  constructor(
    private readonly ctx: EngineContext,
    private readonly source: typeof SHERPA_ONNX_BUILD = SHERPA_ONNX_BUILD,
    private readonly pins: VoicePackPin[] = VOICE_PACKS,
  ) {}

  private get build() {
    return this.source.builds[`${process.platform}-${process.arch}`] ?? null;
  }

  directory(): string {
    return join(
      this.ctx.paths.dataDir,
      "runtimes",
      "sherpa-onnx",
      this.source.version,
    );
  }

  private packDirectory(id: string): string {
    return join(this.ctx.paths.dataDir, "voices", id);
  }

  locate(): {
    path: string | null;
    version: string | null;
    reason: string | null;
  } {
    const program = join(this.directory(), this.source.executable);
    if (existsSync(join(this.directory(), MARKER)) && existsSync(program)) {
      return { path: program, version: this.source.version, reason: null };
    }
    return {
      path: null,
      version: null,
      reason:
        this.build === null
          ? "Framebop's voice runtime has no build for this computer yet."
          : "Framebop's voice runtime is not installed yet.",
    };
  }

  /** The packs that are installed, for the adapter. */
  packs(): VoicePackDescriptor[] {
    return this.pins
      .filter((pin) => existsSync(join(this.packDirectory(pin.id), MARKER)))
      .map(({ url: _u, sha256: _s, sizeBytes: _b, license: _l, ...pin }) => ({
        ...pin,
        directory: this.packDirectory(pin.id),
      }));
  }

  /** The pack for a project language, if there is one. */
  packFor(language: string): VoicePackPin | null {
    return (
      this.pins.find(
        (pin) => pin.language.toLowerCase() === language.toLowerCase(),
      ) ??
      this.pins.find((pin) => speaksLanguage(pin.language, language)) ??
      null
    );
  }

  status(): VoiceSetupStatus {
    const located = this.locate();
    const installed = new Set(this.packs().map((pack) => pack.id));
    return {
      runtime: {
        name: "sherpa-onnx",
        version: this.source.version,
        license: "Apache-2.0",
        state: this.task
          ? "installing"
          : located.path
            ? "installed"
            : this.build === null
              ? "unsupported"
              : "not-installed",
        downloadBytes: this.build?.sizeBytes ?? null,
        installedBytes: located.path ? installedBytes(this.directory()) : null,
        path: located.path,
        installedAt: located.path ? readInstalledAt(this.directory()) : null,
      },
      packs: this.pins.map((pin) => ({
        id: pin.id,
        name: pin.name,
        language: pin.language,
        license: pin.license,
        downloadBytes: pin.sizeBytes,
        installedBytes: installed.has(pin.id)
          ? installedBytes(this.packDirectory(pin.id))
          : null,
        state: installed.has(pin.id)
          ? "installed"
          : this.task && this.packFor(this.task.language)?.id === pin.id
            ? "installing"
            : "not-installed",
      })),
      progress: this.task
        ? { bytesDone: this.task.done, bytesTotal: this.task.total }
        : null,
      error: this.failure,
    };
  }

  /**
   * Starts installing what speaking `language` needs. Only with consent;
   * returns at once, and the status follows the download.
   */
  install(language: string): VoiceSetupStatus {
    const build = this.build;
    const pack = this.packFor(language);
    if (build === null || pack === null) {
      throw new AppError(
        "UNSUPPORTED",
        build === null
          ? "There is no voice runtime for this computer yet."
          : `There is no voice for “${language}” yet.`,
      );
    }
    if (this.task) {
      throw new AppError("CONFLICT", "A voice is already being installed.");
    }
    const needsRuntime = this.locate().path === null;
    const needsPack = !this.packs().some((item) => item.id === pack.id);
    if (!needsRuntime && !needsPack) return this.status();
    this.failure = null;
    this.task = {
      language,
      done: 0,
      total:
        (needsRuntime ? build.sizeBytes : 0) + (needsPack ? pack.sizeBytes : 0),
    };
    const log = this.ctx.log.scope("runtimes");
    void (async () => {
      let offset = 0;
      const progress = (done: number) => {
        if (this.task) this.task.done = offset + done;
      };
      try {
        if (needsRuntime) {
          await this.installPinned(
            build,
            this.directory(),
            this.source.members,
            { name: "sherpa-onnx", version: this.source.version },
            progress,
          );
          await chmod(join(this.directory(), this.source.executable), 0o755);
          offset = build.sizeBytes;
        }
        if (needsPack) {
          await this.installPinned(
            pack,
            this.packDirectory(pack.id),
            [],
            { name: pack.id, version: pack.sha256.slice(0, 12) },
            progress,
          );
        }
        log.info("Installed a voice", { pack: pack.id });
      } catch (error) {
        this.failure =
          error instanceof Error
            ? error.message
            : "The voice was not installed.";
        log.warn("A voice could not be installed", { error: this.failure });
      } finally {
        this.task = null;
      }
    })();
    return this.status();
  }

  /** Deletes the voice program; the packs stay. Only with consent. */
  async removeRuntime(): Promise<VoiceSetupStatus> {
    this.refuseWhileInstalling();
    const freed = await removeInstalled(this.ctx, "runtimes", this.directory());
    if (freed !== null) {
      this.ctx.log.scope("runtimes").info("Removed the voice runtime", {
        version: this.source.version,
        bytes: freed,
      });
    }
    return this.status();
  }

  /** Deletes one installed voice pack. Only with consent. */
  async removePack(id: string): Promise<VoiceSetupStatus> {
    if (!this.pins.some((pin) => pin.id === id)) {
      throw new AppError("NOT_FOUND", "There is no such voice pack.");
    }
    this.refuseWhileInstalling();
    const freed = await removeInstalled(
      this.ctx,
      "voices",
      this.packDirectory(id),
    );
    if (freed !== null) {
      this.ctx.log
        .scope("runtimes")
        .info("Removed a voice pack", { pack: id, bytes: freed });
    }
    return this.status();
  }

  private refuseWhileInstalling(): void {
    if (this.task) {
      throw new AppError(
        "CONFLICT",
        "A voice is being installed. Wait for it to finish first.",
      );
    }
  }

  private async installPinned(
    pin: { url: string; sha256: string; sizeBytes: number },
    directory: string,
    members: string[],
    record: { name: string; version: string },
    onBytes: (done: number) => void,
  ): Promise<void> {
    const work = join(this.ctx.paths.workRoot, `runtime-${this.ctx.newId()}`);
    const staging = `${directory}.partial`;
    try {
      await mkdir(work, { recursive: true });
      const archive = join(work, "download.tar.bz2");
      const digest = await downloadPinned(pin, archive, onBytes);
      await rm(staging, { recursive: true, force: true });
      await untar(archive, staging, members);
      await writeFile(
        join(staging, MARKER),
        JSON.stringify(
          {
            ...record,
            sha256: digest,
            source: pin.url,
            installedAt: this.ctx.now(),
          },
          null,
          2,
        ),
      );
      await rm(directory, { recursive: true, force: true });
      await mkdir(join(directory, ".."), { recursive: true });
      await rename(staging, directory);
    } finally {
      await rm(work, { recursive: true, force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }
}

/** llama.cpp's server, MIT licence, built by its own release workflow. */
export const LLAMA_CPP_BUILD = {
  version: "b11361",
  executable: "llama-server",
  builds: {
    "darwin-arm64": {
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11361/llama-b11361-bin-macos-arm64.tar.gz",
      sha256:
        "9608054c5cb193223963c26bf8293b777e794c4646798b9f3df40fe3985bf767",
      sizeBytes: 11_883_976,
    },
  } as Record<string, { url: string; sha256: string; sizeBytes: number }>,
};

/**
 * The language-model runtime Framebop installs itself, used whenever no
 * llama-server is chosen in Settings.
 */
export class LlamaRuntimeService {
  private installing = false;

  constructor(
    private readonly ctx: EngineContext,
    private readonly source: typeof LLAMA_CPP_BUILD = LLAMA_CPP_BUILD,
  ) {}

  private get build() {
    return this.source.builds[`${process.platform}-${process.arch}`] ?? null;
  }

  directory(): string {
    return join(
      this.ctx.paths.dataDir,
      "runtimes",
      "llama.cpp",
      this.source.version,
    );
  }

  /** The installed llama-server, or null. */
  locate(): string | null {
    const program = join(this.directory(), this.source.executable);
    return existsSync(join(this.directory(), MARKER)) && existsSync(program)
      ? program
      : null;
  }

  status(): ImageRuntimeStatus {
    const path = this.locate();
    return {
      name: "llama.cpp",
      version: this.source.version,
      license: "MIT",
      state: this.installing
        ? "installing"
        : path
          ? "installed"
          : this.build === null
            ? "unsupported"
            : "not-installed",
      downloadBytes: this.build?.sizeBytes ?? null,
      installedBytes: path ? installedBytes(this.directory()) : null,
      path,
      installedAt: path ? readInstalledAt(this.directory()) : null,
    };
  }

  /** Deletes the installed build. Only with consent; not while installing. */
  async remove(): Promise<ImageRuntimeStatus> {
    if (this.installing) {
      throw new AppError(
        "CONFLICT",
        "The language-model runtime is being installed. Wait for it to finish first.",
      );
    }
    const freed = await removeInstalled(this.ctx, "runtimes", this.directory());
    if (freed !== null) {
      this.ctx.log
        .scope("runtimes")
        .info("Removed the language-model runtime", {
          version: this.source.version,
          bytes: freed,
        });
    }
    return this.status();
  }

  /** Downloads, checks and unpacks the pinned build. Only with consent. */
  async install(): Promise<ImageRuntimeStatus> {
    const build = this.build;
    if (build === null) {
      throw new AppError(
        "UNSUPPORTED",
        "There is no language-model runtime for this computer yet.",
      );
    }
    if (this.installing) {
      throw new AppError(
        "CONFLICT",
        "The language-model runtime is already being installed.",
      );
    }
    if (this.locate()) return this.status();
    this.installing = true;
    const work = join(this.ctx.paths.workRoot, `runtime-${this.ctx.newId()}`);
    const staging = `${this.directory()}.partial`;
    try {
      await mkdir(work, { recursive: true });
      const archive = join(work, "runtime.tar.gz");
      const digest = await downloadPinned(build, archive);
      await rm(staging, { recursive: true, force: true });
      await untar(archive, staging);
      const program = join(staging, this.source.executable);
      if (!existsSync(program)) {
        throw new AppError(
          "ENGINE_FAILURE",
          "The runtime archive has no llama-server program.",
        );
      }
      await chmod(program, 0o755);
      await writeFile(
        join(staging, MARKER),
        JSON.stringify(
          {
            name: "llama.cpp",
            version: this.source.version,
            sha256: digest,
            source: build.url,
            installedAt: this.ctx.now(),
          },
          null,
          2,
        ),
      );
      await rm(this.directory(), { recursive: true, force: true });
      await mkdir(join(this.directory(), ".."), { recursive: true });
      await rename(staging, this.directory());
      this.ctx.log
        .scope("runtimes")
        .info("Installed the language-model runtime", {
          version: this.source.version,
        });
    } finally {
      this.installing = false;
      await rm(work, { recursive: true, force: true });
      await rm(staging, { recursive: true, force: true });
    }
    return this.status();
  }
}
