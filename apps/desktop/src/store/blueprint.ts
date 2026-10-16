/**
 * State for the Production Blueprint of the open episode. Every change is an
 * engine call that is saved at once; nothing is generated without a click.
 */
import type {
  AnimationTemplate,
  Blueprint,
  PreflightReport,
  ScenePlanPatch,
} from "@framebop/core";
import { create } from "zustand";
import { EngineError, bridge } from "../lib/bridge";
import { useStudio } from "./studio";
import { t } from "../i18n";
import { errorMessage } from "../lib/errors";

interface BlueprintState {
  episodeId: string | null;
  blueprint: Blueprint | null;
  loading: boolean;
  error: string | null;
  preflight: PreflightReport | null;
  checking: boolean;
  /** Scenes with an action under way. */
  busy: Record<string, boolean>;
  load(episodeId: string): Promise<void>;
  reload(): Promise<void>;
  updatePlan(sceneId: string, patch: ScenePlanPatch): Promise<void>;
  applyAnimation(sceneId: string, template: AnimationTemplate): Promise<void>;
  runPreflight(): Promise<void>;
  previewNarration(sceneId: string): Promise<void>;
  applyPreview(jobId: string): Promise<void>;
  useMeasured(sceneId: string): Promise<void>;
  suggestNarration(sceneId: string, modelId: string): Promise<void>;
  acceptNarration(sceneId: string): Promise<void>;
  discardNarration(sceneId: string): Promise<void>;
}

function report(error: unknown, fallback: string): void {
  useStudio.getState().notify("error", errorMessage(error, fallback));
}

export const useBlueprint = create<BlueprintState>((set, get) => {
  async function act(
    sceneId: string,
    work: () => Promise<unknown>,
    fallback: string,
  ): Promise<void> {
    set((state) => ({ busy: { ...state.busy, [sceneId]: true } }));
    try {
      await work();
      await get().reload();
    } catch (error) {
      report(error, fallback);
    } finally {
      set((state) => ({ busy: { ...state.busy, [sceneId]: false } }));
    }
  }

  return {
    episodeId: null,
    blueprint: null,
    loading: false,
    error: null,
    preflight: null,
    checking: false,
    busy: {},

    async load(episodeId) {
      if (get().episodeId !== episodeId)
        set({ episodeId, blueprint: null, preflight: null });
      set({ loading: get().blueprint === null, error: null });
      try {
        const blueprint = await bridge.call("blueprint.get", { episodeId });
        if (get().episodeId === episodeId) set({ blueprint, loading: false });
      } catch (error) {
        set({
          loading: false,
          error: errorMessage(error, t("blueprint:couldNotLoad")),
        });
      }
    },

    async reload() {
      const episodeId = get().episodeId;
      if (episodeId) await get().load(episodeId);
    },

    async updatePlan(sceneId, patch) {
      await act(
        sceneId,
        () => bridge.call("blueprint.updatePlan", { sceneId, patch }),
        t("blueprint:thePlanCouldNotBeSaved"),
      );
    },

    async applyAnimation(sceneId, template) {
      await act(
        sceneId,
        () =>
          bridge.call("blueprint.applyAnimationTemplate", {
            sceneId,
            template,
          }),
        t("blueprint:theAnimationCouldNotBeApplied"),
      );
    },

    async runPreflight() {
      const episodeId = get().episodeId;
      if (!episodeId) return;
      set({ checking: true });
      try {
        set({
          preflight: await bridge.call("blueprint.preflight", { episodeId }),
        });
      } catch (error) {
        report(error, t("blueprint:thePreflightCouldNotRun"));
      } finally {
        set({ checking: false });
      }
    },

    async previewNarration(sceneId) {
      await act(
        sceneId,
        async () => {
          // Framebop's own voice for the project's language first; the
          // Python Kokoro engine for those who set it up themselves.
          const studio = useStudio.getState();
          const language = (
            studio.projects.find(
              (project) => project.id === studio.activeProjectId,
            )?.language ?? "en"
          )
            .toLowerCase()
            .split("-")[0];
          let found: { adapterId: string; model: string } | null = null;
          for (const adapterId of ["sherpa-onnx", "kokoro"]) {
            const choices = await bridge
              .call("models.choices", { task: "audio_generation", adapterId })
              .catch(() => []);
            const choice = choices.find(
              (item) =>
                item.usable &&
                item.reference &&
                (adapterId !== "sherpa-onnx" ||
                  item.reference.split("-")[0] === language),
            );
            if (choice?.reference) {
              found = { adapterId, model: choice.reference };
              break;
            }
          }
          if (!found) {
            throw new EngineError(
              "UNAVAILABLE",
              t("blueprint:noUsableKokoroModelWasFound"),
            );
          }
          await bridge.call("jobs.createGeneration", {
            sceneId,
            task: "audio_generation",
            adapterId: found.adapterId,
            model: found.model,
          });
        },
        t("blueprint:theNarrationPreviewCouldNotBe"),
      );
    },

    async applyPreview(jobId) {
      const scene = get().blueprint?.scenes.find(
        (item) => item.narration.previewJobId === jobId,
      );
      await act(
        scene?.sceneId ?? jobId,
        () => bridge.call("jobs.applyOutput", { id: jobId }),
        t("blueprint:theNarrationCouldNotBePut"),
      );
    },

    async useMeasured(sceneId) {
      await act(
        sceneId,
        () => bridge.call("blueprint.useMeasuredDuration", { sceneId }),
        t("blueprint:theMeasuredLengthCouldNotBe"),
      );
    },

    async suggestNarration(sceneId, modelId) {
      await act(
        sceneId,
        () => bridge.call("blueprint.suggestNarration", { sceneId, modelId }),
        t("blueprint:aLongerNarrationCouldNotBe"),
      );
    },

    async acceptNarration(sceneId) {
      await act(
        sceneId,
        () => bridge.call("blueprint.acceptNarration", { sceneId }),
        t("blueprint:theSuggestionCouldNotBeUsed"),
      );
    },

    async discardNarration(sceneId) {
      await act(
        sceneId,
        () => bridge.call("blueprint.discardNarration", { sceneId }),
        t("blueprint:theSuggestionCouldNotBeDiscarded"),
      );
    },
  };
});
