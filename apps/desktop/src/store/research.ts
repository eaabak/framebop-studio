/**
 * State for Video DNA Lab. Kept apart from the studio store: research
 * projects are separate from production projects, and nothing here autosaves
 * in the background. Every change is an explicit engine call.
 */
import {
  type AnalysisCapability,
  type LocalLlmStatus,
  type ResearchAnalysis,
  type StoryDraft,
  type StoryDraftSummary,
  type StoryEditable,
  type StoryScope,
  type CommentOrder,
  type EvidenceKind,
  type FindingBasis,
  type ManualMetadata,
  type ReferenceVideoDetail,
  type ResearchProjectDetail,
  type ResearchProjectSummary,
  type TranscriptImport,
  type YouTubeFailure,
  type YouTubeKeyStatus,
  youTubeFailureOf,
} from "@framebop/core";
import { create } from "zustand";
import { EngineError, bridge } from "../lib/bridge";
import { useStudio } from "./studio";
import { t } from "../i18n";
import { errorMessage } from "../lib/errors";

export type LoadState = "idle" | "loading" | "ready" | "error";

/** Work that goes to YouTube or changes stored data, for busy indicators. */
export type ResearchAction =
  | "metadata"
  | "manual"
  | "comments"
  | "transcript"
  | "note"
  | "key"
  | "analysis"
  | "test"
  | "story";

/** The last failure of a YouTube request, shown where it happened. */
export interface ResearchFailure {
  action: "metadata" | "comments";
  reason: YouTubeFailure | null;
  message: string;
}

/** An item the user picked as evidence for a note. */
export interface Citation {
  kind: EvidenceKind;
  targetId: string;
  label: string;
}

interface ResearchState {
  projects: ResearchProjectSummary[];
  projectsState: LoadState;
  projectsError: string | null;
  activeProjectId: string | null;
  project: ResearchProjectDetail | null;
  projectState: LoadState;
  activeVideoId: string | null;
  video: ReferenceVideoDetail | null;
  videoState: LoadState;
  videoError: string | null;
  keyStatus: YouTubeKeyStatus | null;
  capabilities: AnalysisCapability[];
  busy: Partial<Record<ResearchAction, boolean>>;
  failure: ResearchFailure | null;
  citations: Citation[];
  /** Bumped whenever comments change, so open lists reload. */
  commentsVersion: number;
  llm: LocalLlmStatus | null;
  llmError: string | null;
  /** Analyses of the open video, newest first. */
  analyses: ResearchAnalysis[];
  /** The language model chosen for the next analysis. */
  modelId: string | null;
  testResult: { ok: boolean; detail: string } | null;
  /** What the project's main area shows. */
  pane: "video" | "notes" | "story";
  stories: StoryDraftSummary[];
  story: StoryDraft | null;
  /** The user's working copy of the open draft. */
  storyEdit: StoryEditable | null;
  storyDirty: boolean;

  load(): Promise<void>;
  openProject(id: string | null): Promise<void>;
  openVideo(id: string | null): Promise<void>;
  createProject(name: string, description: string): Promise<boolean>;
  updateProject(patch: { name?: string; description?: string }): Promise<void>;
  deleteProject(id: string): Promise<void>;
  addVideo(link: string): Promise<boolean>;
  updateVideoNotes(notes: string): Promise<void>;
  removeVideo(id: string): Promise<void>;
  fetchMetadata(): Promise<void>;
  saveManualMetadata(values: ManualMetadata): Promise<boolean>;
  deleteSnapshot(id: string): Promise<void>;
  fetchComments(mode: "start" | "more", order?: CommentOrder): Promise<void>;
  clearComments(): Promise<void>;
  importTranscript(
    input: Omit<TranscriptImport, "referenceVideoId">,
  ): Promise<string | null>;
  deleteTranscript(id: string): Promise<void>;
  toggleCitation(citation: Citation): void;
  clearCitations(): void;
  createNote(input: {
    title: string;
    statement: string;
    basis: FindingBasis;
    forVideo: boolean;
  }): Promise<boolean>;
  deleteNote(id: string): Promise<void>;
  refreshKey(): Promise<void>;
  setKey(apiKey: string): Promise<boolean>;
  clearKey(): Promise<void>;
  clearFailure(): void;
  refreshLlm(): Promise<void>;
  loadAnalyses(): Promise<void>;
  chooseModel(modelId: string): void;
  testModel(): Promise<void>;
  startAnalysis(): Promise<string | null>;
  cancelAnalysis(id: string): Promise<void>;
  deleteAnalysis(id: string): Promise<void>;
  setPane(pane: ResearchState["pane"]): void;
  loadStories(): Promise<void>;
  openStory(id: string): Promise<void>;
  reloadStory(): Promise<void>;
  developConcept(analysisId: string, itemId: string): Promise<void>;
  editStory(change: (draft: StoryEditable) => StoryEditable): void;
  saveStory(): Promise<boolean>;
  generateStory(scope: StoryScope): Promise<void>;
  cancelStory(): Promise<void>;
  deleteStory(): Promise<void>;
  createProductionProject(): Promise<{
    projectId: string;
    episodeId: string;
  } | null>;
}

const messageOf = errorMessage;

function editable(draft: StoryDraft): StoryEditable {
  return {
    settings: draft.settings,
    outline: draft.outline,
    scenes: draft.scenes,
  };
}

function notifyError(error: unknown, fallback: string): void {
  useStudio.getState().notify("error", messageOf(error, fallback));
}

export const useResearch = create<ResearchState>((set, get) => {
  async function reloadProject(): Promise<void> {
    const id = get().activeProjectId;
    const [projects, project] = await Promise.all([
      bridge.call("research.projects.list", {}),
      id ? bridge.call("research.projects.get", { id }) : null,
    ]);
    if (get().activeProjectId === id) set({ projects, project });
    else set({ projects });
  }

  async function reloadVideo(): Promise<void> {
    const id = get().activeVideoId;
    if (!id) return;
    const video = await bridge.call("research.videos.get", { id });
    if (get().activeVideoId === id) set({ video });
  }

  /** Runs a change, then reloads what it affects. False if it failed. */
  async function change(
    action: ResearchAction | null,
    work: () => Promise<unknown>,
    fallback: string,
  ): Promise<boolean> {
    if (action) set((state) => ({ busy: { ...state.busy, [action]: true } }));
    try {
      await work();
      await Promise.all([reloadVideo(), reloadProject()]);
      return true;
    } catch (error) {
      notifyError(error, fallback);
      return false;
    } finally {
      if (action)
        set((state) => ({ busy: { ...state.busy, [action]: false } }));
    }
  }

  /** Like `change`, for YouTube requests: failures stay visible in place. */
  async function fetchFromYouTube(
    action: "metadata" | "comments",
    work: () => Promise<unknown>,
  ): Promise<void> {
    set((state) => ({
      busy: { ...state.busy, [action]: true },
      failure: null,
    }));
    try {
      await work();
      await Promise.all([reloadVideo(), reloadProject()]);
      if (action === "comments") {
        set((state) => ({ commentsVersion: state.commentsVersion + 1 }));
      }
    } catch (error) {
      set({
        failure: {
          action,
          reason:
            error instanceof EngineError
              ? youTubeFailureOf(error.details)
              : null,
          message: messageOf(error, t("research:youtubeCouldNotBeAsked")),
        },
      });
    } finally {
      set((state) => ({ busy: { ...state.busy, [action]: false } }));
    }
  }

  return {
    projects: [],
    projectsState: "idle",
    projectsError: null,
    activeProjectId: null,
    project: null,
    projectState: "idle",
    activeVideoId: null,
    video: null,
    videoState: "idle",
    videoError: null,
    keyStatus: null,
    capabilities: [],
    busy: {},
    failure: null,
    citations: [],
    commentsVersion: 0,
    llm: null,
    llmError: null,
    analyses: [],
    modelId: null,
    testResult: null,
    pane: "video",
    stories: [],
    story: null,
    storyEdit: null,
    storyDirty: false,

    async load() {
      // A reload keeps what is shown; only the first load shows a spinner.
      if (get().projectsState !== "ready") {
        set({ projectsState: "loading", projectsError: null });
      }
      try {
        const [projects, keyStatus, capabilities] = await Promise.all([
          bridge.call("research.projects.list", {}),
          bridge.call("research.key.status", {}),
          bridge.call("research.analysis.capabilities", {}),
        ]);
        set({ projects, keyStatus, capabilities, projectsState: "ready" });
        // Reopen the most recently worked-on project.
        const { activeProjectId } = get();
        if (!activeProjectId && projects[0]) {
          await get().openProject(projects[0].id);
        } else if (activeProjectId) {
          await reloadProject();
        }
      } catch (error) {
        set({
          projectsState: "error",
          projectsError: messageOf(
            error,
            t("research:researchProjectsCouldNotBeLoaded"),
          ),
        });
      }
    },

    async openProject(id) {
      set({
        activeProjectId: id,
        project: null,
        projectState: id ? "loading" : "idle",
        activeVideoId: null,
        video: null,
        videoState: "idle",
        failure: null,
        citations: [],
      });
      if (!id) return;
      try {
        const project = await bridge.call("research.projects.get", { id });
        if (get().activeProjectId !== id) return;
        set({
          project,
          projectState: "ready",
          pane: "video",
          story: null,
          storyEdit: null,
          storyDirty: false,
        });
        void get().loadStories();
        const first = project.videos[0];
        if (first) await get().openVideo(first.id);
      } catch (error) {
        if (get().activeProjectId !== id) return;
        set({ projectState: "error" });
        notifyError(error, t("research:theResearchProjectCouldNotBe"));
      }
    },

    async openVideo(id) {
      set({
        activeVideoId: id,
        video: null,
        videoState: id ? "loading" : "idle",
        videoError: null,
        failure: null,
      });
      if (!id) return;
      try {
        const video = await bridge.call("research.videos.get", { id });
        if (get().activeVideoId === id) set({ video, videoState: "ready" });
      } catch (error) {
        if (get().activeVideoId !== id) return;
        set({
          videoState: "error",
          videoError: messageOf(error, t("research:theVideoSResearchCouldNot")),
        });
      }
    },

    async createProject(name, description) {
      try {
        const project = await bridge.call("research.projects.create", {
          name,
          description,
        });
        set({ projects: await bridge.call("research.projects.list", {}) });
        await get().openProject(project.id);
        return true;
      } catch (error) {
        notifyError(error, t("research:theResearchProjectCouldNotBe2"));
        return false;
      }
    },

    async updateProject(patch) {
      const id = get().activeProjectId;
      if (!id) return;
      await change(
        null,
        () => bridge.call("research.projects.update", { id, patch }),
        t("research:theChangeCouldNotBeSaved"),
      );
    },

    async deleteProject(id) {
      try {
        await bridge.call("research.projects.delete", { id });
        const projects = await bridge.call("research.projects.list", {});
        set({ projects });
        if (get().activeProjectId === id) {
          await get().openProject(projects[0]?.id ?? null);
        }
      } catch (error) {
        notifyError(error, t("research:theResearchProjectCouldNotBe3"));
      }
    },

    async addVideo(link) {
      const projectId = get().activeProjectId;
      if (!projectId) return false;
      try {
        const video = await bridge.call("research.videos.add", {
          projectId,
          link,
        });
        await reloadProject();
        await get().openVideo(video.id);
        // Fetching is what the user asked for by adding with a key set up.
        if (get().keyStatus?.configured) await get().fetchMetadata();
        return true;
      } catch (error) {
        notifyError(error, t("research:theVideoCouldNotBeAdded"));
        return false;
      }
    },

    async updateVideoNotes(notes) {
      const id = get().activeVideoId;
      if (!id) return;
      await change(
        null,
        () => bridge.call("research.videos.update", { id, patch: { notes } }),
        t("research:theNotesCouldNotBeSaved"),
      );
    },

    async removeVideo(id) {
      try {
        await bridge.call("research.videos.remove", { id });
        set({ citations: [] });
        await reloadProject();
        if (get().activeVideoId === id) {
          await get().openVideo(get().project?.videos[0]?.id ?? null);
        }
      } catch (error) {
        notifyError(error, t("research:theVideoCouldNotBeRemoved"));
      }
    },

    async fetchMetadata() {
      const referenceVideoId = get().activeVideoId;
      if (!referenceVideoId) return;
      await fetchFromYouTube("metadata", () =>
        bridge.call("research.metadata.fetch", { referenceVideoId }),
      );
    },

    async saveManualMetadata(values) {
      const referenceVideoId = get().activeVideoId;
      if (!referenceVideoId) return false;
      const saved = await change(
        "manual",
        () =>
          bridge.call("research.metadata.saveManual", {
            referenceVideoId,
            values,
          }),
        t("research:theDetailsCouldNotBeSaved"),
      );
      if (saved) set({ failure: null });
      return saved;
    },

    async deleteSnapshot(id) {
      await change(
        null,
        () => bridge.call("research.metadata.deleteSnapshot", { id }),
        t("research:theSnapshotCouldNotBeDeleted"),
      );
    },

    async fetchComments(mode, order = "relevance") {
      const referenceVideoId = get().activeVideoId;
      if (!referenceVideoId) return;
      await fetchFromYouTube("comments", () =>
        bridge.call("research.comments.fetch", {
          referenceVideoId,
          mode,
          order,
        }),
      );
    },

    async clearComments() {
      const referenceVideoId = get().activeVideoId;
      if (!referenceVideoId) return;
      const done = await change(
        null,
        () => bridge.call("research.comments.clear", { referenceVideoId }),
        t("research:theCommentsCouldNotBeDeleted"),
      );
      if (done) {
        set((state) => ({
          commentsVersion: state.commentsVersion + 1,
          citations: state.citations.filter((item) => item.kind !== "comment"),
        }));
      }
    },

    async importTranscript(input) {
      const referenceVideoId = get().activeVideoId;
      if (!referenceVideoId) return null;
      set((state) => ({ busy: { ...state.busy, transcript: true } }));
      try {
        const transcript = await bridge.call("research.transcripts.import", {
          ...input,
          referenceVideoId,
        });
        await Promise.all([reloadVideo(), reloadProject()]);
        return transcript.id;
      } catch (error) {
        // Shown in the import dialog, which stays open to fix the problem.
        throw new Error(
          messageOf(error, t("research:theTranscriptCouldNotBeImported")),
        );
      } finally {
        set((state) => ({ busy: { ...state.busy, transcript: false } }));
      }
    },

    async deleteTranscript(id) {
      const done = await change(
        null,
        () => bridge.call("research.transcripts.delete", { id }),
        t("research:theTranscriptCouldNotBeDeleted"),
      );
      if (done) {
        set((state) => ({
          citations: state.citations.filter(
            (item) => item.kind !== "transcript-segment",
          ),
        }));
      }
    },

    toggleCitation(citation) {
      set((state) => ({
        citations: state.citations.some(
          (item) => item.targetId === citation.targetId,
        )
          ? state.citations.filter(
              (item) => item.targetId !== citation.targetId,
            )
          : [...state.citations, citation].slice(-50),
      }));
    },

    clearCitations() {
      set({ citations: [] });
    },

    async createNote({ title, statement, basis, forVideo }) {
      const projectId = get().activeProjectId;
      if (!projectId) return false;
      const done = await change(
        "note",
        () =>
          bridge.call("research.notes.create", {
            projectId,
            referenceVideoId: forVideo ? get().activeVideoId : null,
            title,
            statement,
            basis,
            evidence: get().citations.map(({ kind, targetId }) => ({
              kind,
              targetId,
            })),
          }),
        t("research:theNoteCouldNotBeSaved"),
      );
      if (done) set({ citations: [] });
      return done;
    },

    async deleteNote(id) {
      await change(
        null,
        () => bridge.call("research.notes.delete", { id }),
        t("research:theNoteCouldNotBeDeleted"),
      );
    },

    async refreshKey() {
      try {
        set({ keyStatus: await bridge.call("research.key.status", {}) });
      } catch {
        // Shown as unknown; nothing else depends on it.
      }
    },

    async setKey(apiKey) {
      set((state) => ({ busy: { ...state.busy, key: true } }));
      try {
        set({
          keyStatus: await bridge.call("research.key.set", { apiKey }),
          failure: null,
        });
        return true;
      } catch (error) {
        notifyError(error, t("research:theKeyCouldNotBeSaved"));
        return false;
      } finally {
        set((state) => ({ busy: { ...state.busy, key: false } }));
      }
    },

    async clearKey() {
      try {
        set({ keyStatus: await bridge.call("research.key.clear", {}) });
      } catch (error) {
        notifyError(error, t("research:theKeyCouldNotBeRemoved"));
      }
    },

    clearFailure() {
      set({ failure: null });
    },

    async refreshLlm() {
      try {
        const llm = await bridge.call("llm.status", {});
        const usable = llm.models.filter(
          (model) =>
            model.installation === "installed" ||
            model.installation === "external",
        );
        const current = get().modelId;
        set({
          llm,
          llmError: null,
          modelId:
            current && llm.models.some((model) => model.modelId === current)
              ? current
              : (usable[0]?.modelId ?? llm.models[0]?.modelId ?? null),
        });
      } catch (error) {
        set({
          llmError: messageOf(
            error,
            t("research:theLanguageModelRuntimeCouldNot"),
          ),
        });
      }
    },

    async loadAnalyses() {
      const referenceVideoId = get().activeVideoId;
      if (!referenceVideoId) return set({ analyses: [] });
      try {
        const analyses = await bridge.call("research.analysis.list", {
          referenceVideoId,
        });
        if (get().activeVideoId === referenceVideoId) set({ analyses });
      } catch (error) {
        notifyError(error, t("research:analysesCouldNotBeLoaded"));
      }
    },

    chooseModel(modelId) {
      set({ modelId, testResult: null });
    },

    async testModel() {
      const modelId = get().modelId;
      if (!modelId) return;
      set((state) => ({
        busy: { ...state.busy, test: true },
        testResult: null,
      }));
      try {
        const result = await bridge.call("llm.test", { modelId });
        set({ testResult: { ok: result.ok, detail: result.detail } });
      } catch (error) {
        set({
          testResult: {
            ok: false,
            detail: messageOf(error, t("research:theTestDidNotRun")),
          },
        });
      } finally {
        set((state) => ({ busy: { ...state.busy, test: false } }));
        await get().refreshLlm();
      }
    },

    async startAnalysis() {
      const referenceVideoId = get().activeVideoId;
      const modelId = get().modelId;
      if (!referenceVideoId || !modelId) return null;
      set((state) => ({ busy: { ...state.busy, analysis: true } }));
      try {
        const analysis = await bridge.call("research.analysis.start", {
          referenceVideoId,
          modelId,
        });
        await get().loadAnalyses();
        return analysis.id;
      } catch (error) {
        notifyError(error, t("research:theAnalysisCouldNotBeStarted"));
        return null;
      } finally {
        set((state) => ({ busy: { ...state.busy, analysis: false } }));
      }
    },

    async cancelAnalysis(id) {
      try {
        await bridge.call("research.analysis.cancel", { id });
      } catch (error) {
        notifyError(error, t("research:theAnalysisCouldNotBeCancelled"));
      }
      await get().loadAnalyses();
    },

    setPane(pane) {
      set({ pane });
    },

    async loadStories() {
      const researchProjectId = get().activeProjectId;
      if (!researchProjectId) return set({ stories: [] });
      try {
        const stories = await bridge.call("story.list", { researchProjectId });
        if (get().activeProjectId === researchProjectId) set({ stories });
      } catch (error) {
        notifyError(error, t("research:storyDraftsCouldNotBeLoaded"));
      }
    },

    async openStory(id) {
      try {
        const story = await bridge.call("story.get", { id });
        set({
          pane: "story",
          story,
          storyEdit: editable(story),
          storyDirty: false,
        });
      } catch (error) {
        notifyError(error, t("research:theStoryDraftCouldNotBe"));
      }
    },

    async reloadStory() {
      const current = get().story;
      if (!current) return;
      try {
        const story = await bridge.call("story.get", { id: current.id });
        if (get().story?.id !== story.id) return;
        // Unsaved edits are never replaced by a reload.
        set(
          get().storyDirty ? { story } : { story, storyEdit: editable(story) },
        );
      } catch (error) {
        notifyError(error, t("research:theStoryDraftCouldNotBe2"));
      }
    },

    async developConcept(analysisId, itemId) {
      try {
        const story = await bridge.call("story.create", { analysisId, itemId });
        set({
          pane: "story",
          story,
          storyEdit: editable(story),
          storyDirty: false,
        });
        await get().loadStories();
      } catch (error) {
        notifyError(error, t("research:theStoryDraftCouldNotBe3"));
      }
    },

    editStory(change) {
      const edit = get().storyEdit;
      if (edit) set({ storyEdit: change(edit), storyDirty: true });
    },

    async saveStory() {
      const { story, storyEdit } = get();
      if (!story || !storyEdit) return false;
      set((state) => ({ busy: { ...state.busy, story: true } }));
      try {
        const saved = await bridge.call("story.save", {
          id: story.id,
          baseRevision: story.revision,
          draft: storyEdit,
        });
        set({ story: saved, storyEdit: editable(saved), storyDirty: false });
        void get().loadStories();
        return true;
      } catch (error) {
        notifyError(error, t("research:theDraftCouldNotBeSaved"));
        return false;
      } finally {
        set((state) => ({ busy: { ...state.busy, story: false } }));
      }
    },

    async generateStory(scope) {
      const modelId = get().modelId;
      if (!modelId || !get().story) return;
      // Edits are saved first, so generation starts from what the user sees.
      if (get().storyDirty && !(await get().saveStory())) return;
      const story = get().story as StoryDraft;
      try {
        const updated = await bridge.call("story.generate", {
          id: story.id,
          modelId,
          scope,
        });
        set({
          story: updated,
          storyEdit: editable(updated),
          storyDirty: false,
        });
      } catch (error) {
        notifyError(error, t("research:generationCouldNotBeStarted"));
      }
    },

    async cancelStory() {
      const story = get().story;
      if (!story) return;
      try {
        set({ story: await bridge.call("story.cancel", { id: story.id }) });
      } catch (error) {
        notifyError(error, t("research:generationCouldNotBeCancelled"));
      }
    },

    async deleteStory() {
      const story = get().story;
      if (!story) return;
      try {
        await bridge.call("story.delete", { id: story.id });
        set({ pane: "video", story: null, storyEdit: null, storyDirty: false });
        await get().loadStories();
      } catch (error) {
        notifyError(error, t("research:theDraftCouldNotBeDeleted"));
      }
    },

    async createProductionProject() {
      const story = get().story;
      if (!story || get().storyDirty) return null;
      set((state) => ({ busy: { ...state.busy, story: true } }));
      try {
        const result = await bridge.call("story.createProject", {
          id: story.id,
          baseRevision: story.revision,
          reviewed: true,
        });
        set({ story: result.draft, storyEdit: editable(result.draft) });
        void get().loadStories();
        return { projectId: result.projectId, episodeId: result.episodeId };
      } catch (error) {
        notifyError(error, t("research:theProductionProjectCouldNotBe"));
        return null;
      } finally {
        set((state) => ({ busy: { ...state.busy, story: false } }));
      }
    },

    async deleteAnalysis(id) {
      try {
        await bridge.call("research.analysis.delete", { id });
      } catch (error) {
        notifyError(error, t("research:theAnalysisCouldNotBeDeleted"));
      }
      await get().loadAnalyses();
    },
  };
});
