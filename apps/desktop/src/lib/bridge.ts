/**
 * The interface's only connection to the outside world.
 *
 * Components and the store never import Tauri APIs or call `fetch` directly;
 * they go through the `Bridge` below. Two implementations exist:
 *
 *   desktop  - the shipped application. Calls reach the engine through the
 *              shell's IPC, files are picked with native dialogs, and media
 *              is read through Tauri's scoped asset protocol.
 *   browser  - development only (`pnpm dev:web`). Calls go to the engine's
 *              loopback bridge through the Vite dev server.
 */
import {
  type Asset,
  type AssetKind,
  type CoreEvent,
  type ErrorCode,
  type RenderRecord,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  extensionsFor,
  isErrorShape,
} from "@framebop/core";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { promptForPath } from "./dialogs";
import { t } from "../i18n";

// Injected by Vite: true only under `pnpm dev:web`.
declare const __DEV_BRIDGE__: boolean;

export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode | "UNREACHABLE",
    message: string,
    /** Structured context, such as why a YouTube request failed. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  if (isErrorShape(error)) {
    return new EngineError(error.code, error.message, error.details);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new EngineError("UNREACHABLE", message);
}

export interface FileDropEvent {
  phase: "over" | "leave" | "drop";
  paths: string[];
  /** Pointer position in CSS pixels, relative to the window. */
  x: number;
  y: number;
}

export type EngineProcessStatus =
  { state: "starting" | "running" } | { state: "stopped"; reason: string };

export interface Bridge {
  readonly mode: "desktop" | "browser";
  /** Whether native capabilities (file manager, drag and drop) exist. */
  readonly native: boolean;
  call<M extends RpcMethod>(
    method: M,
    params: RpcParams<M>,
  ): Promise<RpcResult<M>>;
  subscribe(listener: (event: CoreEvent) => void): Promise<() => void>;
  /** Fires when the engine process starts, stops or crashes. Desktop only. */
  onEngineStatus(
    listener: (status: EngineProcessStatus) => void,
  ): Promise<() => void>;
  restartEngine(): Promise<void>;
  /** Must be called once with the library's media root before `mediaUrl`. */
  setMediaRoot(mediaRoot: string): void;
  mediaUrl(asset: Asset, variant: "file" | "thumbnail"): string;
  /** Resolves to an empty list when the user cancels. */
  chooseMediaFiles(
    kinds: readonly AssetKind[],
    multiple: boolean,
  ): Promise<string[]>;
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /** Resolves to null when the user cancels. */
  chooseFolder(title: string): Promise<string | null>;
  /** Any single file, such as a program. Resolves to null when cancelled. */
  chooseFile(title: string): Promise<string | null>;
  revealInFileManager(path: string): Promise<void>;
  /** Opens an exported video in the system's default player. */
  openVideo(path: string): Promise<void>;
  /** Opens a page on huggingface.co or youtube.com in the default browser. */
  openWebPage(url: string): Promise<void>;
  /**
   * A URL the interface can play an exported video from, or null where the
   * webview is not allowed to read it (outside the library's export folder).
   */
  renderUrl(render: RenderRecord, dataDir: string): string | null;
  /** A Scene Doctor evidence picture, by its path under the media root. */
  inspectionFrameUrl(file: string): string;
  onFileDrop(listener: (event: FileDropEvent) => void): Promise<() => void>;
  /** Runs `handler` to completion before the window is allowed to close. */
  onBeforeClose(handler: () => Promise<void>): void;
}

const KIND_LABEL: Record<AssetKind, string> = {
  get image() {
    return t("common:images");
  },
  get video() {
    return t("common:videoClips");
  },
  get audio() {
    return t("common:audio");
  },
};

function describeKinds(kinds: readonly AssetKind[]) {
  return {
    label:
      kinds.length === 1 && kinds[0] ? KIND_LABEL[kinds[0]] : t("common:media"),
    extensions: kinds.flatMap((kind) => extensionsFor(kind)),
  };
}

class DesktopBridge implements Bridge {
  readonly mode = "desktop";
  readonly native = true;
  private mediaRoot = "";
  private separator = "/";

  async call<M extends RpcMethod>(
    method: M,
    params: RpcParams<M>,
  ): Promise<RpcResult<M>> {
    try {
      return await invoke<RpcResult<M>>("engine_call", { method, params });
    } catch (error) {
      throw toEngineError(error);
    }
  }

  subscribe(listener: (event: CoreEvent) => void): Promise<() => void> {
    return listen<CoreEvent>("engine:event", (message) =>
      listener(message.payload),
    );
  }

  async onEngineStatus(
    listener: (status: EngineProcessStatus) => void,
  ): Promise<() => void> {
    const stop = await listen<EngineProcessStatus>("engine:status", (message) =>
      listener(message.payload),
    );
    // Report the current state too, in case it changed before we listened.
    listener(await invoke<EngineProcessStatus>("engine_status"));
    return stop;
  }

  restartEngine(): Promise<void> {
    return invoke("engine_restart");
  }

  setMediaRoot(mediaRoot: string): void {
    this.mediaRoot = mediaRoot;
    this.separator = mediaRoot.includes("\\") ? "\\" : "/";
  }

  mediaUrl(asset: Asset, variant: "file" | "thumbnail"): string {
    const relative =
      variant === "thumbnail" ? asset.thumbnailPath : asset.relativePath;
    // Library paths are stored forward-slashed; convert for this OS.
    const absolute = [this.mediaRoot, ...(relative ?? "").split("/")].join(
      this.separator,
    );
    return convertFileSrc(absolute);
  }

  async chooseMediaFiles(
    kinds: readonly AssetKind[],
    multiple: boolean,
  ): Promise<string[]> {
    const { label, extensions } = describeKinds(kinds);
    const selection = await open({
      multiple,
      directory: false,
      title: t("common:import", { toLowerCase: label.toLowerCase() }),
      filters: [{ name: label, extensions }],
    });
    if (selection === null) return [];
    return Array.isArray(selection) ? selection : [selection];
  }

  async chooseFolder(title: string): Promise<string | null> {
    const selection = await open({ directory: true, multiple: false, title });
    return typeof selection === "string" ? selection : null;
  }

  chooseSavePath(suggestedName: string): Promise<string | null> {
    return save({
      defaultPath: suggestedName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  }

  async chooseFile(title: string): Promise<string | null> {
    const selection = await open({ directory: false, multiple: false, title });
    return typeof selection === "string" ? selection : null;
  }

  revealInFileManager(path: string): Promise<void> {
    return revealItemInDir(path);
  }

  openVideo(path: string): Promise<void> {
    return openPath(path);
  }

  openWebPage(url: string): Promise<void> {
    return openUrl(url);
  }

  inspectionFrameUrl(file: string): string {
    return convertFileSrc(
      [this.mediaRoot, ...file.split("/")].join(this.separator),
    );
  }

  renderUrl(render: RenderRecord, dataDir: string): string | null {
    // Only the library's own export folder is readable by the webview.
    const exports = `${dataDir}${this.separator}exports${this.separator}`;
    return render.path.startsWith(exports) ? convertFileSrc(render.path) : null;
  }

  onFileDrop(listener: (event: FileDropEvent) => void): Promise<() => void> {
    let paths: string[] = [];
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") {
        listener({ phase: "leave", paths: [], x: 0, y: 0 });
        return;
      }
      // Tauri reports physical pixels; the DOM works in CSS pixels.
      const x = payload.position.x / window.devicePixelRatio;
      const y = payload.position.y / window.devicePixelRatio;
      if (payload.type === "enter") paths = payload.paths;
      if (payload.type === "drop") {
        listener({ phase: "drop", paths: payload.paths, x, y });
      } else {
        listener({ phase: "over", paths, x, y });
      }
    });
  }

  onBeforeClose(handler: () => Promise<void>): void {
    void getCurrentWindow().onCloseRequested(async () => {
      await handler();
    });
  }
}

class BrowserBridge implements Bridge {
  readonly mode = "browser";
  readonly native = false;

  async call<M extends RpcMethod>(
    method: M,
    params: RpcParams<M>,
  ): Promise<RpcResult<M>> {
    let reply:
      { ok: true; result: RpcResult<M> } | { ok: false; error: unknown };
    try {
      const response = await fetch("/__engine/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params }),
      });
      if (!response.ok)
        throw new Error(
          t("common:bridgeAnswered", { status: response.status }),
        );
      reply = await response.json();
    } catch (error) {
      throw toEngineError(error);
    }
    if (!reply.ok) throw toEngineError(reply.error);
    return reply.result;
  }

  async subscribe(listener: (event: CoreEvent) => void): Promise<() => void> {
    const source = new EventSource("/__engine/events");
    source.onmessage = (message) =>
      listener(JSON.parse(message.data) as CoreEvent);
    return () => source.close();
  }

  async onEngineStatus(): Promise<() => void> {
    return () => {};
  }

  async restartEngine(): Promise<void> {
    throw new EngineError(
      "UNSUPPORTED",
      t("common:restartPnpmDevWebToRestart"),
    );
  }

  setMediaRoot(): void {}

  mediaUrl(asset: Asset, variant: "file" | "thumbnail"): string {
    const suffix = variant === "thumbnail" ? "/thumbnail" : "";
    return `/__engine/media/${asset.id}${suffix}`;
  }

  async chooseMediaFiles(kinds: readonly AssetKind[]): Promise<string[]> {
    const { label, extensions } = describeKinds(kinds);
    const path = await promptForPath({
      title: t("common:import", { toLowerCase: label.toLowerCase() }),
      message: t("common:browsersCannotRevealFilePathsSo", {
        extensions: extensions.join(", "),
      }),
      placeholder: "/path/to/file",
      confirmLabel: t("common:import2"),
    });
    return path ? [path] : [];
  }

  chooseFolder(title: string): Promise<string | null> {
    return promptForPath({
      title,
      message: t("common:browsersCannotRevealFolderPathsSo"),
      placeholder: "/path/to/folder",
      confirmLabel: t("common:choose"),
    });
  }

  chooseSavePath(suggestedName: string): Promise<string | null> {
    return promptForPath({
      title: t("common:saveAs"),
      message: t("common:enterTheFullPathOfThe", {
        lastIndexOf: suggestedName.slice(suggestedName.lastIndexOf(".")),
      }),
      placeholder: `/path/to/${suggestedName}`,
      confirmLabel: t("common:save"),
    });
  }

  chooseFile(title: string): Promise<string | null> {
    return promptForPath({
      title,
      message: t("common:browsersCannotRevealFilePathsSo2"),
      placeholder: "/path/to/program",
      confirmLabel: t("common:choose"),
    });
  }

  async revealInFileManager(): Promise<void> {
    throw new EngineError("UNSUPPORTED", t("common:notAvailableInTheBrowser"));
  }

  async openVideo(): Promise<void> {
    throw new EngineError("UNSUPPORTED", t("common:notAvailableInTheBrowser"));
  }

  async openWebPage(url: string): Promise<void> {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  inspectionFrameUrl(file: string): string {
    return `/__engine/${file}`;
  }

  renderUrl(render: RenderRecord): string {
    return `/__engine/renders/${render.id}`;
  }

  async onFileDrop(): Promise<() => void> {
    return () => {};
  }

  onBeforeClose(handler: () => Promise<void>): void {
    window.addEventListener("pagehide", () => void handler());
  }
}

class UnavailableBridge extends BrowserBridge {
  override async call<M extends RpcMethod>(): Promise<RpcResult<M>> {
    throw new EngineError(
      "UNREACHABLE",
      t("common:thisPageIsTheFramebopStudio"),
    );
  }
}

function createBridge(): Bridge {
  if (isTauri()) return new DesktopBridge();
  return __DEV_BRIDGE__ ? new BrowserBridge() : new UnavailableBridge();
}

export const bridge: Bridge = createBridge();
