/**
 * Contracts for local text generation.
 *
 * Phase 5A.2 implements these with a llama.cpp worker that Framebop starts,
 * feeds and stops itself, so users never install or open another app (such
 * as Ollama or LM Studio) to use a language model. Models will be GGUF files
 * selected and managed through the Model Manager, like every other model.
 *
 * `llm/llama-cpp.ts` implements them with llama.cpp's own server.
 *
 * The lifecycle is designed for computers with limited memory, such as a
 * 24 GB Apple Silicon Mac where the GPU shares system memory: a model is
 * loaded only when work needs it, only if its estimated footprint fits the
 * budget, and unloaded after a period of inactivity or when a generation
 * job needs the memory.
 */

/** A language model file from the Model Manager. */
export interface TextModelRef {
  /** The Model Manager's id for the catalog entry or external file. */
  modelId: string;
  name: string;
  /** Absolute path of the GGUF file. */
  path: string;
  format: "gguf";
  sizeBytes: number;
  /** The context length the file declares, when known. */
  trainedContextTokens: number | null;
  /**
   * One of llama.cpp's built-in chat templates, from Framebop's verified
   * registry. The template inside the model file is never used.
   */
  chatTemplate: string;
}

/** How much memory text generation may use, decided before loading. */
export interface MemoryBudget {
  totalBytes: number;
  /** Memory free at the time of the check, when the OS reports it. */
  availableBytes: number | null;
  /** Kept free for the system, the interface and other engines. */
  reserveBytes: number;
}

export interface TextModelLoadOptions {
  contextTokens: number;
  /** Layers to offload to the GPU, or "auto" to fit the budget. */
  gpuLayers: number | "auto";
  /** Unload after this long without a request. */
  idleUnloadMs: number;
}

export interface TextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextGenerationRequest {
  messages: readonly TextMessage[];
  maxTokens: number;
  temperature: number;
  /** Constrains output to JSON matching this schema (llama.cpp grammars). */
  jsonSchema?: Record<string, unknown>;
  stop?: readonly string[];
  signal?: AbortSignal;
  onToken?(text: string): void;
}

export interface TextGenerationResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: "stop" | "length" | "cancelled";
}

export type TextProviderState =
  "unavailable" | "idle" | "loading" | "ready" | "busy";

export interface TextProviderStatus {
  state: TextProviderState;
  /** Shown to the user as is. */
  detail: string;
  loadedModelId: string | null;
}

export interface TextGenerationProvider {
  readonly id: string;
  readonly name: string;
  status(): Promise<TextProviderStatus>;
  /**
   * Bytes the model would need with these options, or null when that cannot
   * be estimated. Used to refuse a load that would not fit the budget.
   */
  estimateMemory(
    model: TextModelRef,
    options: TextModelLoadOptions,
  ): Promise<number | null>;
  load(
    model: TextModelRef,
    options: TextModelLoadOptions,
    budget: MemoryBudget,
    signal?: AbortSignal,
  ): Promise<void>;
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
  /** Frees the model's memory. Safe to call when nothing is loaded. */
  unload(): Promise<void>;
}
