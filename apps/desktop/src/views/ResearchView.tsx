import {
  type ReferenceVideoSummary,
  formatClock,
  parseYouTubeLink,
} from "@framebop/core";
import {
  BookOpen,
  CloudDownload,
  Dna,
  ExternalLink,
  FolderPlus,
  KeyRound,
  Link2,
  NotebookPen,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Modal,
  Spinner,
  cx,
} from "../components/ui";
import { confirm, openPanel } from "../lib/dialogs";
import { useResearch } from "../store/research";
import { useOpenWebPage } from "./models/shared";
import { AnalysisPanel } from "./research/AnalysisPanel";
import { CommentsPanel } from "./research/CommentsPanel";
import { EvidencePanel, FindingCard, NoteForm } from "./research/EvidencePanel";
import { SourcesPanel } from "./research/SourcesPanel";
import { StoryArchitect } from "./research/StoryArchitect";
import { TranscriptPanel } from "./research/TranscriptPanel";
import { ManualMetadataDialog, VideoOverview } from "./research/VideoOverview";
import { FailureBanner, formatNumber } from "./research/shared";
import { currentLanguage, t } from "../i18n";

function NewProjectDialog({ onClose }: { onClose(): void }) {
  const createProject = useResearch((state) => state.createProject);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const created = await createProject(name.trim(), description.trim());
    setBusy(false);
    if (created) onClose();
  }
  return (
    <Modal
      title={t("research:newResearchProject")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("research:cancel")}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => void submit()}
          >
            {t("research:createProject")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t("research:name")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("research:whatDoYouWantToLearn")}
          hint={t("research:optionalForExampleHowCookingChannels")}
        >
          {(id) => (
            <textarea
              id={id}
              rows={3}
              className="control resize-y"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function KeyStatusLine() {
  const keyStatus = useResearch((state) => state.keyStatus);
  if (!keyStatus) return null;
  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="flex items-center gap-2">
        <KeyRound
          className={cx(
            "size-3.5 shrink-0",
            keyStatus.configured ? "text-ok" : "text-fg-dim",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">
          {keyStatus.configured
            ? keyStatus.source === "secure-storage" && keyStatus.secureStorage
              ? t("research:keySetSecure", { storage: keyStatus.secureStorage })
              : keyStatus.source === "session"
                ? t("research:keySetSession")
                : keyStatus.source === "environment"
                  ? t("research:keySetEnvironment")
                  : t("research:keySet")
            : t("research:noYoutubeApiKey")}
        </span>
        <button
          type="button"
          className="text-2xs text-fg-dim hover:text-accent"
          onClick={() => openPanel("settings")}
        >
          {keyStatus.configured ? t("research:change") : t("research:setUp")}
        </button>
      </div>
    </div>
  );
}

function ProjectList({ onNew }: { onNew(): void }) {
  const projects = useResearch((state) => state.projects);
  const activeProjectId = useResearch((state) => state.activeProjectId);
  const openProject = useResearch((state) => state.openProject);
  return (
    <aside className="glass m-2 mr-0 flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl border">
      <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3">
        <h2 className="eyebrow">{t("research:research")}</h2>
        <IconButton
          label={t("research:newResearchProject")}
          icon={FolderPlus}
          size="sm"
          onClick={onNew}
        />
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {projects.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              aria-current={project.id === activeProjectId ? "true" : undefined}
              onClick={() => void openProject(project.id)}
              className={cx(
                "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                project.id === activeProjectId
                  ? "bg-accent/10 text-fg"
                  : "text-fg-muted hover:bg-overlay hover:text-fg",
              )}
            >
              <span className="truncate text-ui font-medium">
                {project.name}
              </span>
              <span className="text-2xs text-fg-dim">
                {t("common:videoCount", { count: project.videoCount })} ·{" "}
                {new Date(project.updatedAt).toLocaleDateString(
                  currentLanguage(),
                  {
                    dateStyle: "medium",
                  },
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <KeyStatusLine />
    </aside>
  );
}

function AddVideo() {
  const addVideo = useResearch((state) => state.addVideo);
  const keyConfigured = useResearch(
    (state) => state.keyStatus?.configured ?? false,
  );
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseYouTubeLink(link);
  const showProblem = link.trim() !== "" && !parsed.ok;

  async function submit() {
    if (!parsed.ok || busy) return;
    setBusy(true);
    if (await addVideo(link)) setLink("");
    setBusy(false);
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-dim"
            aria-hidden
          />
          <input
            aria-label={t("research:youtubeVideoLink")}
            aria-invalid={showProblem}
            className="control pl-8"
            placeholder={t("research:pasteAYoutubeVideoLink")}
            spellCheck={false}
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          icon={keyConfigured ? CloudDownload : Plus}
          busy={busy}
          disabled={!parsed.ok}
        >
          {keyConfigured
            ? t("research:addAndFetchDetails")
            : t("research:addVideo")}
        </Button>
      </div>
      <p
        className={cx("text-2xs", showProblem ? "text-danger" : "text-fg-dim")}
      >
        {showProblem && !parsed.ok
          ? parsed.reason
          : parsed.ok
            ? t("research:videoOnlyThisIdIsUsed", { videoId: parsed.videoId })
            : keyConfigured
              ? t("research:detailsComeFromTheYoutubeData")
              : t("research:withoutAnApiKeyYouCan")}
      </p>
    </form>
  );
}

function VideoRow({
  video,
  active,
  onOpen,
}: {
  video: ReferenceVideoSummary;
  active: boolean;
  onOpen(): void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
        className={cx(
          "flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors",
          active
            ? "border-accent/40 bg-accent/5"
            : "border-transparent hover:bg-overlay",
        )}
      >
        <span
          className={cx(
            "line-clamp-2 text-xs font-medium",
            video.title ? "text-fg" : "text-fg-muted italic",
          )}
        >
          {video.title ??
            t("research:youtubeVideo", { videoId: video.videoId })}
        </span>
        <span className="truncate text-2xs text-fg-dim">
          {[
            video.channelTitle,
            video.durationSeconds !== null
              ? formatClock(video.durationSeconds)
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || t("research:noDetailsYet")}
        </span>
        <span className="flex flex-wrap gap-1">
          {video.metadataSource === "manual" && (
            <Badge tone="warn">{t("research:enteredByHand")}</Badge>
          )}
          {video.storedComments > 0 && (
            <Badge>
              {t("research:comments", {
                storedComments: formatNumber(video.storedComments),
              })}
            </Badge>
          )}
          {video.transcripts > 0 && <Badge>{t("research:transcript")}</Badge>}
        </span>
      </button>
    </li>
  );
}

type VideoTab =
  "overview" | "comments" | "transcript" | "evidence" | "analysis" | "sources";

function VideoWorkspace() {
  const detail = useResearch((state) => state.video);
  const videoState = useResearch((state) => state.videoState);
  const videoError = useResearch((state) => state.videoError);
  const activeVideoId = useResearch((state) => state.activeVideoId);
  const openVideo = useResearch((state) => state.openVideo);
  const fetchMetadata = useResearch((state) => state.fetchMetadata);
  const removeVideo = useResearch((state) => state.removeVideo);
  const failure = useResearch((state) => state.failure);
  const busy = useResearch((state) => state.busy.metadata ?? false);
  const keyConfigured = useResearch(
    (state) => state.keyStatus?.configured ?? false,
  );
  const citations = useResearch((state) => state.citations.length);
  const openWebPage = useOpenWebPage();
  const [tab, setTab] = useState<VideoTab>("overview");
  const [manual, setManual] = useState(false);

  if (videoState === "loading" || (videoState === "idle" && activeVideoId)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (videoState === "error") {
    return (
      <ErrorState
        message={videoError ?? t("research:theVideoCouldNotBeLoaded")}
        onRetry={() => void openVideo(activeVideoId)}
      />
    );
  }
  if (!detail) return null;

  const { video, snapshot, commentSample, transcripts, findings } = detail;
  const title =
    snapshot?.metadata.title ??
    t("research:youtubeVideo", { videoId: video.videoId });
  const tabs: { id: VideoTab; label: string; count?: ReactNode }[] = [
    { id: "overview", label: t("research:overview") },
    {
      id: "comments",
      label: t("research:comments2"),
      count:
        commentSample && commentSample.status !== "comments-disabled"
          ? formatNumber(commentSample.storedCount)
          : undefined,
    },
    {
      id: "transcript",
      label: t("research:transcript"),
      count: transcripts.length || undefined,
    },
    {
      id: "evidence",
      label: t("research:evidence"),
      count: findings.length || undefined,
    },
    { id: "analysis", label: t("research:aiAnalysis") },
    { id: "sources", label: t("research:sources") },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            data-selectable
            className={cx(
              "text-base font-semibold tracking-tight",
              snapshot?.metadata.title ? "text-fg" : "text-fg-muted",
            )}
          >
            {title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-fg-dim">
            {[
              snapshot?.metadata.channelTitle,
              snapshot?.metadata.durationSeconds != null
                ? formatClock(snapshot.metadata.durationSeconds)
                : null,
              video.url,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {keyConfigured && (
            <Button
              size="sm"
              variant={snapshot ? "secondary" : "primary"}
              icon={snapshot ? RefreshCw : CloudDownload}
              busy={busy}
              onClick={() => void fetchMetadata()}
            >
              {snapshot
                ? t("research:refreshFromYoutube")
                : t("research:fetchFromYoutube")}
            </Button>
          )}
          <Button size="sm" icon={PencilLine} onClick={() => setManual(true)}>
            {t("research:enterByHand")}
          </Button>
          <IconButton
            label={t("research:openOnYoutube")}
            icon={ExternalLink}
            onClick={() => void openWebPage(video.url)}
          />
          <IconButton
            tone="danger"
            label={t("research:removeThisVideoFromTheProject")}
            icon={Trash2}
            onClick={async () => {
              if (
                await confirm({
                  title: t("research:removeThisVideo"),
                  message: t(
                    "research:itsDetailsCommentsTranscriptsFindingsAnd",
                  ),
                  confirmLabel: t("research:removeVideo"),
                  tone: "danger",
                })
              ) {
                await removeVideo(video.id);
              }
            }}
          />
        </div>
      </header>

      {failure && (
        <FailureBanner
          failure={failure}
          onEnterManually={() => setManual(true)}
        />
      )}

      <nav
        role="tablist"
        aria-label={t("research:researchOnThisVideo")}
        className="flex gap-1 border-b border-line"
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-ui transition-colors",
              tab === entry.id
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {entry.label}
            {entry.count !== undefined && (
              <span className="text-2xs text-fg-dim tabular-nums">
                {entry.count}
              </span>
            )}
            {entry.id === "evidence" && citations > 0 && (
              <Badge tone="accent">{t("research:marked", { citations })}</Badge>
            )}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <VideoOverview
          detail={detail}
          onEnterManually={() => setManual(true)}
        />
      )}
      {tab === "comments" && <CommentsPanel detail={detail} />}
      {tab === "transcript" && <TranscriptPanel detail={detail} />}
      {tab === "evidence" && <EvidencePanel detail={detail} />}
      {tab === "analysis" && <AnalysisPanel detail={detail} />}
      {tab === "sources" && <SourcesPanel detail={detail} />}

      {manual && <ManualMetadataDialog onClose={() => setManual(false)} />}
    </div>
  );
}

function ProjectNotes() {
  const notes = useResearch((state) => state.project?.notes ?? []);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">
          {t("research:projectNotes")}
        </h2>
        <p className="text-xs text-fg-muted">
          {t("research:notesAboutTheProjectAsA")}
        </p>
      </div>
      {notes.map((note) => (
        <FindingCard key={note.id} finding={note} />
      ))}
      <div className="card-surface rounded-xl border p-3">
        <NoteForm forVideo={false} />
      </div>
    </div>
  );
}

function ProjectHeader() {
  const project = useResearch((state) => state.project?.project);
  const updateProject = useResearch((state) => state.updateProject);
  const deleteProject = useResearch((state) => state.deleteProject);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  useEffect(() => {
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
  }, [project?.name, project?.description]);
  if (!project) return null;
  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface/60 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            aria-label={t("research:projectName")}
            className="w-full rounded bg-transparent text-lg font-semibold tracking-tight text-fg outline-none focus:bg-canvas"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() && name !== project.name)
                void updateProject({ name: name.trim() });
              else setName(project.name);
            }}
          />
          <input
            aria-label={t("research:whatThisResearchIsFor")}
            className="w-full rounded bg-transparent text-xs text-fg-muted outline-none placeholder:text-fg-dim focus:bg-canvas"
            placeholder={t("research:whatDoYouWantToLearn2")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== project.description)
                void updateProject({ description });
            }}
          />
        </div>
        <IconButton
          tone="danger"
          label={t("research:deleteThisResearchProject")}
          icon={Trash2}
          onClick={async () => {
            if (
              await confirm({
                title: t("research:delete", { name: project.name }),
                message: t("research:itsVideosAndEverythingCollectedFor"),
                confirmLabel: t("research:deleteProject"),
                tone: "danger",
              })
            ) {
              await deleteProject(project.id);
            }
          }}
        />
      </div>
      <AddVideo />
    </header>
  );
}

function ProjectWorkspace() {
  const project = useResearch((state) => state.project);
  const projectState = useResearch((state) => state.projectState);
  const activeVideoId = useResearch((state) => state.activeVideoId);
  const openVideo = useResearch((state) => state.openVideo);
  const pane = useResearch((state) => state.pane);
  const setPane = useResearch((state) => state.setPane);
  const stories = useResearch((state) => state.stories);
  const activeStoryId = useResearch((state) => state.story?.id ?? null);
  const openStory = useResearch((state) => state.openStory);
  const showNotes = pane === "notes";

  if (projectState === "loading" || !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ProjectHeader />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col border-r border-line">
          <button
            type="button"
            onClick={() => setPane("notes")}
            className={cx(
              "flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-left text-xs transition-colors",
              showNotes
                ? "bg-accent/5 text-fg"
                : "text-fg-muted hover:bg-overlay hover:text-fg",
            )}
          >
            <NotebookPen className="size-3.5" aria-hidden />
            {t("research:projectNotes")}
            <span className="ml-auto text-2xs text-fg-dim">
              {project.notes.length}
            </span>
          </button>
          {stories.length > 0 && (
            <ul className="flex shrink-0 flex-col gap-0.5 border-b border-line p-2">
              <li className="px-1 pb-1 text-2xs tracking-wide text-fg-dim uppercase">
                {t("research:storyDrafts")}
              </li>
              {stories.map((story) => (
                <li key={story.id}>
                  <button
                    type="button"
                    onClick={() => void openStory(story.id)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      pane === "story" && story.id === activeStoryId
                        ? "bg-accent/10 text-fg"
                        : "text-fg-muted hover:bg-overlay hover:text-fg",
                    )}
                  >
                    <BookOpen className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {story.title}
                    </span>
                    <span className="shrink-0 text-2xs text-fg-dim">
                      {story.productionProjectId
                        ? t("research:inProduction")
                        : `${story.sceneCount} scenes`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {project.videos.length === 0 ? (
            <EmptyState
              compact
              icon={Video}
              title={t("research:noReferenceVideos")}
              description={t("research:pasteAYoutubeLinkAboveTo")}
            />
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {project.videos.map((video) => (
                <VideoRow
                  key={video.id}
                  video={video}
                  active={pane === "video" && video.id === activeVideoId}
                  onOpen={() => {
                    setPane("video");
                    void openVideo(video.id);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {pane === "story" ? (
            <StoryArchitect />
          ) : showNotes ? (
            <ProjectNotes />
          ) : activeVideoId ? (
            <VideoWorkspace />
          ) : (
            <EmptyState
              icon={Video}
              title={t("research:pickAReferenceVideo")}
              description={t("research:orAddOneByPastingIts")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ResearchView() {
  const projectsState = useResearch((state) => state.projectsState);
  const projectsError = useResearch((state) => state.projectsError);
  const projects = useResearch((state) => state.projects);
  const load = useResearch((state) => state.load);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  if (projectsState === "error") {
    return (
      <ErrorState
        message={
          projectsError ?? t("research:researchProjectsCouldNotBeLoaded")
        }
        onRetry={() => void load()}
      />
    );
  }
  if (projectsState !== "ready") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ProjectList onNew={() => setCreating(true)} />
      <div className="min-w-0 flex-1">
        {projects.length === 0 ? (
          <EmptyState
            icon={Dna}
            title={t("research:videoDnaLab")}
            description={t("research:studyReferenceVideosTheirPublicDetails")}
            action={
              <Button
                variant="primary"
                icon={FolderPlus}
                onClick={() => setCreating(true)}
              >
                {t("research:newResearchProject")}
              </Button>
            }
          />
        ) : (
          <ProjectWorkspace />
        )}
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
