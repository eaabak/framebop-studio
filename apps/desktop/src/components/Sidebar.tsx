import { formatDuration } from "@framebop/core";
import { ChevronRight, Film, FolderPlus, Plus } from "lucide-react";
import { openPanel } from "../lib/dialogs";
import { languageName } from "../lib/languages";
import { useStudio } from "../store/studio";
import { AssetThumb } from "./media";
import { Button, EmptyState, IconButton, Spinner, cx } from "./ui";
import { currentLanguage, t } from "../i18n";

function EpisodeList() {
  const episodes = useStudio((state) => state.episodes);
  const episodesState = useStudio((state) => state.episodesState);
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const openEpisode = useStudio((state) => state.openEpisode);
  const tab = useStudio((state) => state.tab);
  const setTab = useStudio((state) => state.setTab);

  if (episodesState === "loading") {
    return (
      <div className="flex justify-center py-3">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 py-1 pl-3">
      {episodes.map((episode, index) => {
        const active = episode.id === activeEpisodeId;
        return (
          <button
            key={episode.id}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => {
              void openEpisode(episode.id);
              // Picking an episode from the project list means "work on it".
              if (tab === "projects") setTab("scenes");
            }}
            className={cx(
              "group flex items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors duration-150",
              active
                ? "bg-accent/15 shadow-[inset_2px_0_0_var(--color-accent)]"
                : "hover:bg-white/[0.05]",
            )}
          >
            <AssetThumb
              asset={episode.coverAsset}
              placeholder={`E${index + 1}`}
              className={cx(
                "h-[34px] w-[60px] shrink-0 rounded border",
                active ? "border-accent/50" : "border-line",
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span
                className={cx(
                  "truncate text-xs font-medium",
                  active ? "text-fg" : "text-fg-muted group-hover:text-fg",
                )}
              >
                {episode.title}
              </span>
              <span className="truncate text-2xs text-fg-dim">
                {t("common:sceneCount", { count: episode.sceneCount })}
                {episode.sceneCount > 0 &&
                  ` · ${formatDuration(episode.totalDurationSeconds)}`}
              </span>
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => openPanel("newEpisode")}
        className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-fg-dim transition-colors hover:bg-overlay hover:text-fg"
      >
        <Plus className="size-3.5" aria-hidden />
        {t("navigation:newEpisode")}
      </button>
    </div>
  );
}

function ProjectMetadata() {
  const project = useStudio((state) =>
    state.projects.find((candidate) => candidate.id === state.activeProjectId),
  );
  const setTab = useStudio((state) => state.setTab);
  if (!project) return null;

  const rows: [string, string][] = [
    [
      t("navigation:targetLength"),
      formatDuration(project.targetDurationSeconds),
    ],
    [
      t("navigation:plannedSoFar"),
      formatDuration(project.totalDurationSeconds),
    ],
    [t("navigation:language"), languageName(project.language)],
    [
      t("navigation:visualStyle"),
      project.visualStyle || t("navigation:notSet"),
    ],
    [
      t("navigation:updated"),
      new Date(project.updatedAt).toLocaleDateString(currentLanguage(), {
        dateStyle: "medium",
      }),
    ],
  ];

  return (
    <section className="shrink-0 border-t border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="eyebrow">{t("navigation:project")}</h2>
        <button
          type="button"
          onClick={() => setTab("projects")}
          className="text-2xs text-fg-dim hover:text-accent"
        >
          {t("navigation:edit")}
        </button>
      </div>
      <dl className="flex flex-col gap-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-xs">
            <dt className="shrink-0 text-fg-dim">{label}</dt>
            <dd className="truncate text-right text-fg-muted" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Sidebar() {
  const projects = useStudio((state) => state.projects);
  const activeProjectId = useStudio((state) => state.activeProjectId);
  const openProject = useStudio((state) => state.openProject);

  return (
    <aside className="glass flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl border">
      <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3">
        <h2 className="eyebrow">{t("navigation:projects")}</h2>
        <IconButton
          label={t("navigation:newProject")}
          icon={FolderPlus}
          size="sm"
          onClick={() => openPanel("newProject")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <EmptyState
            compact
            icon={Film}
            title={t("navigation:noProjectsYet")}
            description={t("navigation:aProjectHoldsTheEpisodesOf")}
            action={
              <Button
                size="sm"
                variant="primary"
                icon={Plus}
                onClick={() => openPanel("newProject")}
              >
                {t("navigation:newProject")}
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {projects.map((project) => {
              const active = project.id === activeProjectId;
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    aria-expanded={active}
                    onClick={() => void openProject(project.id)}
                    className={cx(
                      "flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors duration-150",
                      active
                        ? "bg-white/[0.06] font-medium text-fg"
                        : "text-fg-muted hover:bg-white/[0.05] hover:text-fg",
                    )}
                  >
                    <ChevronRight
                      className={cx(
                        "size-3.5 shrink-0 text-fg-dim transition-transform",
                        active && "rotate-90",
                      )}
                      aria-hidden
                    />
                    <span className="truncate text-ui font-medium">
                      {project.name}
                    </span>
                    <span className="ml-auto shrink-0 text-2xs text-fg-dim tabular-nums">
                      {project.episodeCount}
                    </span>
                  </button>
                  {active && <EpisodeList />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ProjectMetadata />
    </aside>
  );
}
