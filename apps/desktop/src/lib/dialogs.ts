import type { Asset } from "@framebop/core";
import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
}

export interface PathPromptOptions {
  title: string;
  message: string;
  placeholder: string;
  confirmLabel: string;
}

type Request =
  | ({ kind: "confirm"; resolve(confirmed: boolean): void } & ConfirmOptions)
  | ({ kind: "path"; resolve(path: string | null): void } & PathPromptOptions);

export type Panel = "newProject" | "newEpisode" | "settings";

interface DialogState {
  /** A blocking question awaiting an answer. Shown above any panel. */
  request: Request | null;
  /** A form dialog opened from the interface. */
  panel: Panel | null;
  /** An asset being looked at in a larger view. */
  preview: Asset | null;
}

export const useDialogs = create<DialogState>(() => ({
  request: null,
  panel: null,
  preview: null,
}));

export function openMediaPreview(asset: Asset): void {
  useDialogs.setState({ preview: asset });
}

export function closeMediaPreview(): void {
  useDialogs.setState({ preview: null });
}

/** Asks the user to confirm an action. Resolves false if they dismiss it. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.setState({ request: { kind: "confirm", ...options, resolve } });
  });
}

/**
 * Asks for a file path as text. Only used when the interface runs in a
 * browser during development, where native file dialogs are unavailable.
 */
export function promptForPath(
  options: PathPromptOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.setState({ request: { kind: "path", ...options, resolve } });
  });
}

export function openPanel(panel: Panel): void {
  useDialogs.setState({ panel });
}

export function closePanel(): void {
  useDialogs.setState({ panel: null });
}
