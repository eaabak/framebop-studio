import { type ProjectSummary, formatDuration } from "@framebop/core";
import { ArrowRight, Film, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AssetThumb } from "../components/media";
import { Button, EmptyState, Field, IconButton, cx } from "../components/ui";
import { openPanel } from "../lib/dialogs";
import { LANGUAGES, languageName } from "../lib/languages";
import { useStudio } from "../store/studio";
import { t } from "../i18n";

function ProjectCard({
  project,
  active,
}: {
  project: ProjectSummary;
  active: boolean;
}) {
  const openProject = useStudio((state) => state.openProject);
  const setTab = useStudio((state) => state.setTab);

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => void openProject(project.id)}
      onDoubleClick={() => setTab("scenes")}
      className={cx(
        "group flex flex-col overflow-hidden rounded-2xl border bg-white/[0.035] text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_12px_30px_-14px_rgb(0_0_0/0.7)] transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5",
        active
          ? "border-accent/70 bg-accent/[0.07] shadow-[0_0_0_1px_rgb(255_122_31/0.5),0_16px_36px_-14px_rgb(255_122_31/0.45)]"
          : "border-white/[0.07] hover:border-white/[0.14] hover:bg-white/[0.06]",
      )}
    >
      <AssetThumb
        asset={project.coverAsset}
        placeholder={project.name.slice(0, 2).toUpperCase()}
        className="aspect-video w-full bg-gradient-to-br from-raised to-stage"
      />
      <div className="flex flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-semibold text-fg">
          {project.name}
        </h3>
        <p className="line-clamp-2 min-h-8 text-xs leading-4 text-fg-muted">
          {project.description || t("projects:noDescription")}
        </p>
        <p className="mt-1 text-2xs text-fg-dim">
          {t("common:episodeCount", { count: project.episodeCount })} ·{" "}
          {t("common:sceneCount", { count: project.sceneCount })} ·{" "}
          {t("projects:durationOfTarget", {
            duration: formatDuration(project.totalDurationSeconds),
            target: formatDuration(project.targetDurationSeconds),
          })}
        </p>
      </div>
    </button>
  );
}

/** Project fields save when a field loses focus, and only if valid and changed. */
function ProjectForm({ project }: { project: ProjectSummary }) {
  const updateProject = useStudio((state) => state.updateProject);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [minutes, setMinutes] = useState(
    String(project.targetDurationSeconds / 60),
  );
  const [visualStyle, setVisualStyle] = useState(project.visualStyle);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setMinutes(
      String(Math.round((project.targetDurationSeconds / 60) * 100) / 100),
    );
    setVisualStyle(project.visualStyle);
  }, [
    project.id,
    project.name,
    project.description,
    project.targetDurationSeconds,
    project.visualStyle,
  ]);

  const seconds = Math.round(Number(minutes) * 60);
  const minutesValid =
    Number.isFinite(seconds) && seconds >= 5 && seconds <= 6 * 3600;
  const nameValid = name.trim().length > 0;

  return (
    <div className="flex flex-col gap-3.5">
      <Field
        label={t("projects:name")}
        error={nameValid ? null : t("projects:aProjectNeedsAName")}
      >
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            maxLength={120}
            aria-invalid={!nameValid}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (!nameValid) setName(project.name);
              else if (name.trim() !== project.name)
                void updateProject(project.id, { name });
            }}
          />
        )}
      </Field>
      <Field label={t("projects:description")}>
        {(id) => (
          <textarea
            id={id}
            className="control"
            rows={3}
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== project.description)
                void updateProject(project.id, { description });
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("projects:targetLengthMinutes")}
          error={minutesValid ? null : t("projects:n01To360")}
        >
          {(id) => (
            <input
              id={id}
              className="control tabular-nums"
              type="number"
              min={0.1}
              max={360}
              step="any"
              value={minutes}
              aria-invalid={!minutesValid}
              onChange={(event) => setMinutes(event.target.value)}
              onBlur={() => {
                if (!minutesValid)
                  setMinutes(String(project.targetDurationSeconds / 60));
                else if (seconds !== project.targetDurationSeconds) {
                  void updateProject(project.id, {
                    targetDurationSeconds: seconds,
                  });
                }
              }}
            />
          )}
        </Field>
        <Field label={t("projects:narrationLanguage")}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={project.language}
              onChange={(event) =>
                void updateProject(project.id, { language: event.target.value })
              }
            >
              {/* Keep a language set elsewhere selectable even if it is not listed. */}
              {!LANGUAGES.includes(project.language) && (
                <option value={project.language}>{project.language}</option>
              )}
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label={t("projects:visualStyle")}>
        {(id) => (
          <textarea
            id={id}
            className="control"
            rows={2}
            value={visualStyle}
            maxLength={500}
            placeholder={t("projects:painterlyWarmLight2dAnimation")}
            onChange={(event) => setVisualStyle(event.target.value)}
            onBlur={() => {
              if (visualStyle !== project.visualStyle)
                void updateProject(project.id, { visualStyle });
            }}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * The open project's details, shown as a panel of its own beside the main
 * one, like the project list on the other side.
 */
export function ProjectDetailPanel() {
  const project = useStudio((state) =>
    state.projects.find((candidate) => candidate.id === state.activeProjectId),
  );
  return project ? <ProjectDetail project={project} /> : null;
}

function ProjectDetail({ project }: { project: ProjectSummary }) {
  const episodes = useStudio((state) => state.episodes);
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const openEpisode = useStudio((state) => state.openEpisode);
  const deleteEpisode = useStudio((state) => state.deleteEpisode);
  const deleteProject = useStudio((state) => state.deleteProject);
  const setTab = useStudio((state) => state.setTab);

  return (
    <aside
      aria-label={t("projects:projectDetails")}
      className="glass flex w-[380px] shrink-0 flex-col overflow-y-auto rounded-2xl border"
    >
      <section className="shrink-0 border-b border-line p-4">
        <h2 className="eyebrow mb-3">{t("projects:projectDetails")}</h2>
        <ProjectForm project={project} />
      </section>

      <section className="shrink-0 border-b border-line p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="eyebrow">{t("projects:episodes")}</h2>
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() => openPanel("newEpisode")}
          >
            {t("projects:newEpisode")}
          </Button>
        </div>
        {episodes.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-3 text-xs leading-5 text-fg-muted">
            {t("projects:noEpisodesYetAnEpisodeHas")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {episodes.map((episode, index) => (
              <li
                key={episode.id}
                className={cx(
                  "group flex items-center gap-2.5 rounded-md border p-1.5",
                  episode.id === activeEpisodeId
                    ? "border-accent/30 bg-accent/5"
                    : "border-line",
                )}
              >
                <AssetThumb
                  asset={episode.coverAsset}
                  placeholder={`E${index + 1}`}
                  className="h-9 w-16 shrink-0 rounded"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    void openEpisode(episode.id);
                    setTab("scenes");
                  }}
                >
                  <div className="truncate text-xs font-medium text-fg group-hover:text-accent">
                    {episode.title}
                  </div>
                  <div className="text-2xs text-fg-dim">
                    {t("common:sceneCount", { count: episode.sceneCount })} ·{" "}
                    {formatDuration(episode.totalDurationSeconds)}
                  </div>
                </button>
                <IconButton
                  tone="danger"
                  label={t("projects:delete", { title: episode.title })}
                  icon={Trash2}
                  size="sm"
                  onClick={() => void deleteEpisode(episode.id)}
                />
              </li>
            ))}
          </ul>
        )}
        {activeEpisodeId && (
          <Button
            variant="primary"
            icon={ArrowRight}
            className="mt-3 w-full"
            onClick={() => setTab("scenes")}
          >
            {t("projects:openInScenes")}
          </Button>
        )}
      </section>

      <section className="mt-auto shrink-0 p-4">
        <h2 className="eyebrow mb-2">{t("projects:dangerZone")}</h2>
        <p className="mb-2.5 text-xs leading-5 text-fg-muted">
          {t("projects:deletingAProjectRemovesItsEpisodes")}
        </p>
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => void deleteProject(project.id)}
        >
          {t("projects:deleteProject")}
        </Button>
      </section>
    </aside>
  );
}

export function ProjectsView() {
  const projects = useStudio((state) => state.projects);
  const activeProjectId = useStudio((state) => state.activeProjectId);
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={Film}
        title={t("projects:startYourFirstProduction")}
        description={t("projects:aProjectGroupsTheEpisodesOf")}
        action={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => openPanel("newProject")}
          >
            {t("projects:newProject")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              {t("projects:projects")}
            </h1>
            <p className="text-xs text-fg-muted">
              {t("projects:projectsInLibrary", { count: projects.length })}
            </p>
          </div>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => openPanel("newProject")}
          >
            {t("projects:newProject")}
          </Button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              active={project.id === activeProjectId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
