/**
 * Local text generation with llama.cpp's own server (`llama-server`), started
 * and stopped by Framebop. No other application is involved.
 *
 * The server is bound to 127.0.0.1 on a free port and protected with a key
 * generated for each start, passed in a file (mode 0600, deleted once the
 * server is up) so it never appears in the process list. Its web interface
 * and slot monitoring are turned off. `LLAMA_ARG_*` environment variables
 * are removed, so nothing outside Framebop can change how it listens.
 *
 * The chat template comes from Framebop's verified registry (one of
 * llama.cpp's built-in templates, `--no-jinja`), never from the model file.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, isAbsolute, join } from "node:path";
import { AppError } from "@framebop/core";
import { runCommand } from "../host/exec";
import type {
  MemoryBudget,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
  TextModelLoadOptions,
  TextModelRef,
  TextProviderStatus,
} from "../text-generation";
import { kvCacheBytes, readGgufInfo } from "./gguf";

export const LLAMA_CPP_RUNTIME = "llama.cpp";

export interface LlamaRuntimeInfo {
  path: string;
  /** As the binary reports it, e.g. "0.6.0-dev (build 11641, commit 843e7dcc1)". */
  version: string;
  build: number | null;
  commit: string | null;
}

const SERVER_NAMES = new Set(["llama-server", "llama-server.exe"]);
const TEMPLATE_NAME = /^[a-z0-9][a-z0-9.-]{0,40}$/;
const OUTPUT_TAIL = 8 * 1024;

/** Parses `llama-server --version`, old ("version: 5432 (abc)") or new. */
export function parseLlamaVersion(
  output: string,
): Omit<LlamaRuntimeInfo, "path"> | null {
  const line = /version:\s*(.+)/.exec(output)?.[1]?.trim();
  if (!line) return null;
  const build =
    /build (\d+)/.exec(line)?.[1] ?? /^(\d+)\s/.exec(line)?.[1] ?? null;
  const commit =
    /commit ([0-9a-f]{6,40})/.exec(line)?.[1] ??
    /\(([0-9a-f]{6,40})\)/.exec(line)?.[1] ??
    null;
  return { version: line, build: build ? Number(build) : null, commit };
}

/** Checks that `path` is a runnable llama-server and asks it for its version. */
export async function probeLlamaServer(
  path: string,
): Promise<LlamaRuntimeInfo> {
  if (!isAbsolute(path) || !SERVER_NAMES.has(basename(path))) {
    throw new AppError(
      "VALIDATION",
      "Choose the llama-server program from a llama.cpp build.",
    );
  }
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
    await access(path, constants.X_OK);
  } catch {
    throw new AppError(
      "UNAVAILABLE",
      `llama-server was not found or cannot be run: ${path}`,
    );
  }
  const result = await runCommand(path, ["--version"], { timeoutMs: 15_000 });
  const parsed = parseLlamaVersion(`${result.stdout}\n${result.stderr}`);
  if (!parsed) {
    throw new AppError(
      "UNAVAILABLE",
      "That program did not report a llama.cpp version.",
    );
  }
  return { path, ...parsed };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function cleanEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("LLAMA_ARG_")),
  );
}

/** Bytes the model would use: its weights plus the key and value cache. */
export async function estimateModelMemory(
  model: TextModelRef,
  contextTokens: number,
): Promise<{
  totalBytes: number;
  weightsBytes: number;
  cacheBytes: number;
} | null> {
  const info = await readGgufInfo(model.path);
  const cacheBytes = kvCacheBytes(info, contextTokens);
  if (cacheBytes === null) return null;
  return {
    totalBytes: model.sizeBytes + cacheBytes,
    weightsBytes: model.sizeBytes,
    cacheBytes,
  };
}

interface Running {
  child: ChildProcess;
  port: number;
  apiKey: string;
  model: TextModelRef;
  options: TextModelLoadOptions;
  exited: Promise<number | null>;
}

export class LlamaServerProvider implements TextGenerationProvider {
  readonly id = LLAMA_CPP_RUNTIME;
  readonly name = "llama.cpp";
  private running: Running | null = null;
  private state: TextProviderStatus["state"] = "idle";
  private detail = "No model loaded.";
  private outputTail = "";
  /** Aborted when the server stops, failing any request still waiting. */
  private stopped = new AbortController();

  constructor(
    private readonly options: {
      serverPath: string;
      /** A folder of Framebop's own for the per-start key file. */
      workDirectory: string;
      env?: NodeJS.ProcessEnv;
      startTimeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  get pid(): number | null {
    return this.running?.child.pid ?? null;
  }

  async status(): Promise<TextProviderStatus> {
    return {
      state: this.state,
      detail: this.detail,
      loadedModelId: this.running?.model.modelId ?? null,
    };
  }

  async estimateMemory(
    model: TextModelRef,
    options: TextModelLoadOptions,
  ): Promise<number | null> {
    return (
      (await estimateModelMemory(model, options.contextTokens))?.totalBytes ??
      null
    );
  }

  async load(
    model: TextModelRef,
    options: TextModelLoadOptions,
    budget: MemoryBudget,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = this.running;
    if (
      current &&
      current.model.path === model.path &&
      current.options.contextTokens === options.contextTokens
    ) {
      return;
    }
    await this.unload();
    if (!TEMPLATE_NAME.test(model.chatTemplate)) {
      throw new AppError(
        "VALIDATION",
        "The model's chat template name is not valid.",
      );
    }
    const needed = await this.estimateMemory(model, options);
    const allowed = budget.totalBytes - budget.reserveBytes;
    if (needed !== null && needed > allowed) {
      throw new AppError(
        "UNAVAILABLE",
        `This model needs about ${(needed / 1024 ** 3).toFixed(1)} GB with a ${options.contextTokens}-token context, more than the ${(allowed / 1024 ** 3).toFixed(1)} GB allowed for language models on this computer.`,
      );
    }

    const port = await freePort();
    const apiKey = randomBytes(24).toString("hex");
    const keyFile = join(
      this.options.workDirectory,
      `llama-key-${randomBytes(6).toString("hex")}`,
    );
    await writeFile(keyFile, `${apiKey}\n`, { mode: 0o600 });
    const args = [
      "--model",
      model.path,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--api-key-file",
      keyFile,
      "--ctx-size",
      String(options.contextTokens),
      "--gpu-layers",
      options.gpuLayers === "auto" ? "999" : String(options.gpuLayers),
      "--parallel",
      "1",
      "--no-jinja",
      "--chat-template",
      model.chatTemplate,
      "--no-webui",
      "--no-slots",
      "--offline",
    ];
    this.state = "loading";
    this.detail = `Loading ${model.name}…`;
    this.outputTail = "";
    this.stopped = new AbortController();
    const stopped = this.stopped;

    let child: ChildProcess;
    try {
      child = spawn(this.options.serverPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: cleanEnvironment(this.options.env ?? process.env),
      });
    } catch (error) {
      await rm(keyFile, { force: true });
      this.state = "idle";
      throw new AppError(
        "UNAVAILABLE",
        `llama-server could not be started: ${String(error)}`,
      );
    }
    const keep = (chunk: Buffer) => {
      this.outputTail = `${this.outputTail}${chunk.toString("utf8")}`.slice(
        -OUTPUT_TAIL,
      );
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("exit", (code) => resolve(code));
    });
    const running: Running = { child, port, apiKey, model, options, exited };
    this.running = running;
    void exited.then((code) => {
      stopped.abort();
      if (this.running === running) {
        this.running = null;
        this.state = "idle";
        this.detail = `llama-server stopped (exit code ${code ?? "unknown"}).`;
      }
    });

    try {
      await this.waitUntilHealthy(running, signal);
    } catch (error) {
      await this.unload();
      throw error;
    } finally {
      await rm(keyFile, { force: true });
    }
    this.state = "ready";
    this.detail = `${model.name} is loaded.`;
  }

  private async waitUntilHealthy(
    running: Running,
    signal?: AbortSignal,
  ): Promise<void> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const deadline = Date.now() + (this.options.startTimeoutMs ?? 180_000);
    let exited = false;
    void running.exited.then(() => {
      exited = true;
    });
    while (Date.now() < deadline) {
      if (signal?.aborted)
        throw new AppError("CANCELLED", "Loading the model was cancelled.");
      if (exited) {
        throw new AppError(
          "ENGINE_FAILURE",
          `llama-server stopped while loading the model. ${this.lastLines()}`,
        );
      }
      try {
        const response = await fetchImpl(
          `http://127.0.0.1:${running.port}/health`,
          {
            signal: AbortSignal.timeout(2000),
          },
        );
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new AppError(
      "ENGINE_FAILURE",
      "llama-server did not finish loading the model in time.",
    );
  }

  private lastLines(): string {
    return this.outputTail.trim().split("\n").slice(-3).join(" ").slice(-400);
  }

  async generate(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResult> {
    const running = this.running;
    if (!running || this.state === "loading") {
      throw new AppError("UNAVAILABLE", "No language model is loaded.");
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const signals = [
      this.stopped.signal,
      ...(request.signal ? [request.signal] : []),
    ];
    this.state = "busy";
    try {
      const response = await fetchImpl(
        `http://127.0.0.1:${running.port}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${running.apiKey}`,
          },
          signal: AbortSignal.any(signals),
          body: JSON.stringify({
            messages: request.messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            stream: false,
            ...(request.stop ? { stop: request.stop } : {}),
            ...(request.jsonSchema
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "output",
                      schema: request.jsonSchema,
                      strict: true,
                    },
                  },
                }
              : {}),
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        choices?: {
          message?: { content?: unknown };
          finish_reason?: unknown;
        }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
        error?: { message?: unknown };
      } | null;
      if (!response.ok) {
        const message =
          typeof body?.error?.message === "string"
            ? body.error.message
            : `status ${response.status}`;
        throw new AppError(
          "ENGINE_FAILURE",
          `llama-server refused the request: ${message}`,
        );
      }
      const choice = body?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string") {
        throw new AppError("ENGINE_FAILURE", "llama-server returned no text.");
      }
      return {
        text,
        promptTokens: Number(body?.usage?.prompt_tokens ?? 0),
        completionTokens: Number(body?.usage?.completion_tokens ?? 0),
        finishReason: choice?.finish_reason === "length" ? "length" : "stop",
      };
    } catch (error) {
      if (request.signal?.aborted)
        throw new AppError("CANCELLED", "The request was cancelled.");
      if (this.stopped.signal.aborted) {
        throw new AppError(
          "ENGINE_FAILURE",
          `llama-server stopped unexpectedly. ${this.lastLines()}`,
        );
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        "ENGINE_FAILURE",
        `llama-server could not be reached: ${String(error)}`,
      );
    } finally {
      if (this.running === running) this.state = "ready";
    }
  }

  /** Stops the server and frees its memory. Safe to call at any time. */
  async unload(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.running = null;
    running.child.kill("SIGTERM");
    const killer = setTimeout(() => running.child.kill("SIGKILL"), 5000);
    await running.exited;
    clearTimeout(killer);
    this.state = "idle";
    this.detail = "No model loaded.";
  }

  /** Resident memory of the server process as the OS reports it, or null. */
  async residentBytes(): Promise<number | null> {
    const pid = this.pid;
    if (!pid || process.platform === "win32") return null;
    const result = await runCommand("ps", ["-o", "rss=", "-p", String(pid)], {
      timeoutMs: 5000,
    });
    const kilobytes = Number(result.stdout.trim());
    return result.ok && Number.isFinite(kilobytes) && kilobytes > 0
      ? kilobytes * 1024
      : null;
  }
}
