/**
 * The local language model: Framebop's own llama.cpp server, started for a
 * piece of work and stopped afterwards.
 *
 * Models come from the Model Manager: catalog entries that state how the
 * runtime should run them (`entry.llm`), installed by Framebop or found in a
 * folder the user added (read only). Whether a model actually works is known
 * only from a real run; each run is recorded per model and runtime build.
 *
 * Memory: language models may use at most half of this computer's memory,
 * and run in the production lane, so they never run alongside a generation
 * job. The model is unloaded after every analysis and test.
 */
import { stat } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import {
  LLAMA_CPP_RUNTIME,
  LlamaServerProvider,
  type LlamaRuntimeInfo,
  type MemoryBudget,
  type ModelCandidate,
  type ModelEvaluation,
  type TextGenerationProvider,
  type TextModelLoadOptions,
  type TextModelRef,
  estimateModelMemory,
  probeLlamaServer,
  readGgufInfo,
} from "@framebop/ai-adapters";
import {
  AppError,
  type CatalogEntry,
  type LocalLlmStatus,
  type LocalModelOption,
  type ModelStatus,
} from "@framebop/core";
import type { EngineContext } from "../context";
import type { ModelEvaluator, ModelService } from "./models";
import { getSettings } from "./settings";

/** A provider the service can also measure and unload. */
export type ManagedProvider = TextGenerationProvider & {
  residentBytes?(): Promise<number | null>;
};

export interface LocalLlmOptions {
  /** Overridable for tests: how a runtime is checked, and how one is started. */
  probe?: (path: string) => Promise<LlamaRuntimeInfo>;
  createProvider?: (
    serverPath: string,
    workDirectory: string,
  ) => ManagedProvider;
  totalMemoryBytes?: number;
  /** The llama-server Framebop installed itself, used when none is chosen. */
  managedServer?: () => string | null;
}

interface RuntimeState {
  path: string | null;
  info: LlamaRuntimeInfo | null;
  reason: string | null;
}

export function runtimeLabel(info: LlamaRuntimeInfo): string {
  return `llama.cpp ${info.version}`;
}

export class LocalLlmService implements ModelEvaluator {
  readonly id = LLAMA_CPP_RUNTIME;
  readonly name = "llama.cpp";
  readonly task = "research_analysis";
  private provider: ManagedProvider | null = null;
  private providerPath: string | null = null;
  private probed: {
    path: string;
    mtimeMs: number;
    state: RuntimeState;
  } | null = null;
  /** Serialises loading, generating and unloading. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Calls of `withModel` that have not finished, waiting ones included. */
  private active = 0;

  constructor(
    private readonly ctx: EngineContext,
    private readonly models: ModelService,
    private readonly options: LocalLlmOptions = {},
  ) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => {});
    return next;
  }

  /** The configured llama-server and what it reports, checked again when the file changes. */
  async runtime(): Promise<RuntimeState> {
    const path =
      getSettings(this.ctx).llamaServerPath ??
      this.options.managedServer?.() ??
      null;
    if (!path) {
      return {
        path: null,
        info: null,
        reason:
          "Framebop's language-model runtime is not installed yet, and no llama-server is chosen in Settings.",
      };
    }
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(path)).mtimeMs;
    } catch {
      return {
        path,
        info: null,
        reason: `llama-server was not found at ${path}.`,
      };
    }
    if (this.probed?.path === path && this.probed.mtimeMs === mtimeMs)
      return this.probed.state;
    let state: RuntimeState;
    try {
      const info = await (this.options.probe ?? probeLlamaServer)(path);
      state = { path, info, reason: null };
    } catch (error) {
      state = {
        path,
        info: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    this.probed = { path, mtimeMs, state };
    return state;
  }

  budget(): MemoryBudget {
    const totalBytes = this.options.totalMemoryBytes ?? totalmem();
    return {
      totalBytes,
      availableBytes: null,
      reserveBytes: Math.round(totalBytes / 2),
    };
  }

  /** For the Model Manager: whether this runtime could run a model's files. */
  async evaluateModel(candidate: ModelCandidate): Promise<ModelEvaluation> {
    if (
      candidate.format !== "gguf" ||
      candidate.runtime !== LLAMA_CPP_RUNTIME
    ) {
      return {
        usable: false,
        kind: "unsupported",
        reason: "llama.cpp runs only GGUF language models.",
      };
    }
    const runtime = await this.runtime();
    if (!runtime.info) {
      return {
        usable: false,
        kind: "runtime-missing",
        reason: runtime.reason ?? "llama-server is not set up.",
      };
    }
    return {
      usable: true,
      reason: `${runtimeLabel(runtime.info)} can load GGUF files. Whether this model works is confirmed by a test run.`,
    };
  }

  private static modelPath(
    status: ModelStatus,
  ): { path: string; external: boolean } | null {
    const file = status.entry.files[0]?.path;
    if (!file) return null;
    const installation = status.installation;
    if (
      installation?.state === "installed" &&
      installation.verification === "verified"
    ) {
      return { path: join(installation.directory, file), external: false };
    }
    const copy = status.external[0];
    if (copy)
      return {
        path: copy.path.endsWith(".gguf") ? copy.path : join(copy.path, file),
        external: true,
      };
    return null;
  }

  private async option(
    status: ModelStatus,
    runtime: RuntimeState,
  ): Promise<LocalModelOption> {
    const entry = status.entry;
    const llm = entry.llm as NonNullable<CatalogEntry["llm"]>;
    const located = LocalLlmService.modelPath(status);
    const downloading =
      status.installation !== null &&
      ["pending", "downloading", "verifying"].includes(
        status.installation.state,
      );
    let file: LocalModelOption["file"] = null;
    let compatibility = {
      ok: false,
      reason: "Not on this computer. Download it in AI Models.",
    };
    let estimatedMemoryBytes: number | null = null;
    if (located) {
      try {
        const info = await readGgufInfo(located.path);
        file = {
          architecture: info.architecture,
          layers: info.blockCount,
          trainedContextTokens: info.trainedContextTokens,
        };
        compatibility = info.architecture
          ? {
              ok: true,
              reason: `A GGUF ${info.version} file for the ${info.architecture} architecture.`,
            }
          : {
              ok: false,
              reason: "The GGUF file does not name its architecture.",
            };
        estimatedMemoryBytes =
          (
            await estimateModelMemory(
              this.ref(entry, located.path),
              llm.contextTokens,
            )
          )?.totalBytes ?? null;
      } catch (error) {
        compatibility = {
          ok: false,
          reason: `The file could not be read as GGUF: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    const check = runtime.info
      ? this.ctx.db.research.inferenceCheck(
          entry.id,
          runtimeLabel(runtime.info),
        )
      : null;
    return {
      modelId: entry.id,
      name: entry.name,
      quantization: entry.quantization,
      sizeBytes: entry.files.reduce((total, item) => total + item.sizeBytes, 0),
      provider: entry.provider,
      license: entry.license.name,
      installation: located
        ? located.external
          ? "external"
          : "installed"
        : downloading
          ? "downloading"
          : "not-installed",
      path: located?.path ?? null,
      file,
      compatibility,
      estimatedMemoryBytes,
      contextTokens: llm.contextTokens,
      inferenceCheck:
        check && runtime.info
          ? { ...check, runtime: runtimeLabel(runtime.info) }
          : null,
    };
  }

  private ref(entry: CatalogEntry, path: string): TextModelRef {
    const llm = entry.llm as NonNullable<CatalogEntry["llm"]>;
    return {
      modelId: entry.id,
      name: entry.name,
      path,
      format: "gguf",
      sizeBytes: entry.files.reduce((total, item) => total + item.sizeBytes, 0),
      trainedContextTokens: null,
      chatTemplate: llm.chatTemplate,
    };
  }

  async status(): Promise<LocalLlmStatus> {
    const runtime = await this.runtime();
    const statuses = (await this.models.list()).filter(
      (status) => status.entry.llm !== null,
    );
    const provider = this.provider ? await this.provider.status() : null;
    return {
      runtime: {
        path: runtime.path,
        version: runtime.info ? runtimeLabel(runtime.info) : null,
        available: runtime.info !== null,
        reason: runtime.reason,
      },
      state: runtime.info ? (provider?.state ?? "idle") : "unavailable",
      detail: runtime.info
        ? (provider?.detail ?? "No model loaded.")
        : (runtime.reason ?? ""),
      loadedModelId: provider?.loadedModelId ?? null,
      residentBytes: (await this.provider?.residentBytes?.()) ?? null,
      budgetBytes: this.budget().totalBytes - this.budget().reserveBytes,
      models: await Promise.all(
        statuses.map((status) => this.option(status, runtime)),
      ),
    };
  }

  /** Why `modelId` cannot be used right now, or what to load. */
  async prepare(modelId: string): Promise<{
    ref: TextModelRef;
    options: TextModelLoadOptions;
    runtime: LlamaRuntimeInfo;
    longForm: boolean;
  }> {
    const runtime = await this.runtime();
    if (!runtime.info || !runtime.path) {
      throw new AppError(
        "UNAVAILABLE",
        runtime.reason ?? "llama-server is not set up.",
      );
    }
    const status = (await this.models.list()).find(
      (item) => item.entry.id === modelId,
    );
    if (!status?.entry.llm)
      throw new AppError(
        "NOT_FOUND",
        "That language model is not in the catalog.",
      );
    const located = LocalLlmService.modelPath(status);
    if (!located) {
      throw new AppError(
        "UNAVAILABLE",
        `${status.entry.name} is not on this computer yet. Download it in AI Models.`,
      );
    }
    return {
      ref: this.ref(status.entry, located.path),
      options: {
        contextTokens: status.entry.llm.contextTokens,
        gpuLayers: "auto",
        idleUnloadMs: 0,
      },
      runtime: runtime.info,
      longForm: status.entry.llm.longForm,
    };
  }

  /** Loads a model, runs `work` with it, and always unloads afterwards. */
  async withModel<T>(
    modelId: string,
    signal: AbortSignal | undefined,
    work: (provider: ManagedProvider, runtime: LlamaRuntimeInfo) => Promise<T>,
    onLoaded?: () => void,
  ): Promise<T> {
    this.active += 1;
    try {
      const prepared = await this.prepare(modelId);
      return await this.exclusive(async () => {
        try {
          const provider = this.providerFor(prepared.runtime.path);
          await provider.load(
            prepared.ref,
            prepared.options,
            this.budget(),
            signal,
          );
          onLoaded?.();
          return await work(provider, prepared.runtime);
        } finally {
          await this.provider?.unload();
        }
      });
    } finally {
      this.active -= 1;
    }
  }

  /** Whether a model is being loaded or used, or waits to be. */
  inUse(): boolean {
    return this.active > 0;
  }

  private providerFor(serverPath: string): ManagedProvider {
    if (!this.provider || this.providerPath !== serverPath) {
      void this.provider?.unload();
      this.provider =
        this.options.createProvider?.(serverPath, this.ctx.paths.workRoot) ??
        new LlamaServerProvider({
          serverPath,
          workDirectory: this.ctx.paths.workRoot,
          env: this.ctx.env,
        });
      this.providerPath = serverPath;
    }
    return this.provider;
  }

  /** A short real run, recorded as this model's inference check. */
  async test(modelId: string): Promise<{
    ok: boolean;
    detail: string;
    durationMs: number;
    residentBytes: number | null;
    runtime: string;
  }> {
    const started = Date.now();
    let residentBytes: number | null = null;
    let runtime = "";
    try {
      const reply = await this.withModel(
        modelId,
        undefined,
        async (provider, info) => {
          runtime = runtimeLabel(info);
          const result = await provider.generate({
            messages: [
              { role: "user", content: 'Reply with JSON: {"status": "ready"}' },
            ],
            maxTokens: 20,
            temperature: 0,
            jsonSchema: {
              type: "object",
              properties: { status: { type: "string" } },
              required: ["status"],
            },
          });
          residentBytes = (await provider.residentBytes?.()) ?? null;
          JSON.parse(result.text);
          return result;
        },
      );
      const durationMs = Date.now() - started;
      const detail = `Answered in ${(durationMs / 1000).toFixed(1)} s with valid JSON (${reply.completionTokens} tokens), including loading the model.`;
      this.record(modelId, runtime, true, detail);
      return { ok: true, detail, durationMs, residentBytes, runtime };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (runtime) this.record(modelId, runtime, false, detail);
      throw error instanceof AppError
        ? error
        : new AppError("ENGINE_FAILURE", detail);
    }
  }

  record(modelId: string, runtime: string, ok: boolean, detail: string): void {
    this.ctx.db.research.recordInferenceCheck({
      modelId,
      runtime,
      ok,
      detail,
      checkedAt: this.ctx.now(),
    });
  }

  async unload(): Promise<void> {
    await this.exclusive(async () => this.provider?.unload());
  }
}
