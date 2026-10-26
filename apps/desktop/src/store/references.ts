/**
 * Visual references of the open project: characters, places and styles that
 * several scenes share. Saved by the engine at once, like everything else.
 */
import type { RpcParams, VisualReference } from "@framebop/core";
import { create } from "zustand";
import { bridge } from "../lib/bridge";
import { errorMessage } from "../lib/errors";
import { t } from "../i18n";
import { useStudio } from "./studio";

interface ReferenceState {
  projectId: string | null;
  references: VisualReference[];
  load(projectId: string): Promise<void>;
  save(
    input: Omit<RpcParams<"visualReferences.save">, "projectId">,
  ): Promise<VisualReference | null>;
  remove(id: string): Promise<void>;
  importImage(id: string): Promise<VisualReference | null>;
}

function report(error: unknown, fallback: string): void {
  useStudio.getState().notify("error", errorMessage(error, fallback));
}

export const useReferences = create<ReferenceState>((set, get) => ({
  projectId: null,
  references: [],

  async load(projectId) {
    if (get().projectId !== projectId) set({ projectId, references: [] });
    try {
      const references = await bridge.call("visualReferences.list", {
        projectId,
      });
      const ids = [...new Set(references.flatMap((item) => item.assetIds))];
      const batches = [];
      for (let offset = 0; offset < ids.length; offset += 200) {
        batches.push(
          bridge.call("assets.getMany", {
            ids: ids.slice(offset, offset + 200),
          }),
        );
      }
      const pictures = (await Promise.all(batches)).flat();
      if (get().projectId === projectId) {
        useStudio.setState((state) => ({
          assets: {
            ...state.assets,
            ...Object.fromEntries(pictures.map((asset) => [asset.id, asset])),
          },
        }));
        set({ references });
      }
    } catch (error) {
      report(error, t("media:referencesCouldNotBeLoaded"));
    }
  },

  async save(input) {
    const { projectId } = get();
    if (!projectId) return null;
    try {
      const saved = await bridge.call("visualReferences.save", {
        ...input,
        projectId,
      });
      set((state) => ({
        references: [
          ...state.references.filter((item) => item.id !== saved.id),
          saved,
        ].sort((a, b) => a.name.localeCompare(b.name)),
      }));
      return saved;
    } catch (error) {
      report(error, t("media:theReferenceCouldNotBeSaved"));
      return null;
    }
  },

  async importImage(id) {
    const [sourcePath] = await bridge.chooseMediaFiles(["image"], false);
    if (!sourcePath) return null;
    try {
      const result = await bridge.call("visualReferences.importImage", {
        referenceId: id,
        sourcePath,
      });
      useStudio.setState((state) => ({
        assets: { ...state.assets, [result.asset.id]: result.asset },
      }));
      set((state) => ({
        references: state.references.map((item) =>
          item.id === id ? result.reference : item,
        ),
      }));
      return result.reference;
    } catch (error) {
      report(error, t("video:referenceImportFailed"));
      return null;
    }
  },

  async remove(id) {
    try {
      await bridge.call("visualReferences.delete", { id });
      set((state) => ({
        references: state.references.filter((item) => item.id !== id),
      }));
    } catch (error) {
      report(error, t("media:theReferenceCouldNotBeDeleted"));
    }
  },
}));
