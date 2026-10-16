import {
  CAMERA_MOTIONS,
  type OutlineSection,
  type StoryEditable,
  type StoryScene,
  TRANSITIONS,
  estimateNarrationSeconds,
  formatClock,
  sceneSeconds,
  wordBudget,
} from "@framebop/core";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  ListTree,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Field,
  IconButton,
  ProgressBar,
  cx,
} from "../../components/ui";
import { confirm } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { useStudio } from "../../store/studio";
import { DetailBlock } from "../models/shared";
import { formatDate } from "./shared";
import { t } from "../../i18n";

const ACTIVE = new Set([
  "queued",
  "loading-model",
  "outline",
  "scenes",
  "validating",
]);

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function move<T>(items: readonly T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

function TextArea({
  label,
  value,
  onChange,
  rows = 2,
  hint,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  rows?: number;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <textarea
          id={id}
          rows={rows}
          className="control resize-y"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function SettingsForm({
  edit,
  change,
}: {
  edit: StoryEditable;
  change(next: StoryEditable["settings"]): void;
}) {
  const s = edit.settings;
  const set = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) =>
    change({ ...s, [key]: value });
  return (
    <DetailBlock title={t("story:projectSettings")}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("story:workingTitle")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={s.title}
              maxLength={120}
              onChange={(event) => set("title", event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("story:targetDurationMinutes")}
          hint={t("story:n8MinutesOrMoreWorksLong")}
        >
          {(id) => (
            <input
              id={id}
              type="number"
              min={0.5}
              max={120}
              step={0.5}
              className="control"
              value={s.targetDurationSeconds / 60}
              onChange={(event) =>
                set(
                  "targetDurationSeconds",
                  Math.min(
                    7200,
                    Math.max(
                      30,
                      Math.round(Number(event.target.value) * 60) || 30,
                    ),
                  ),
                )
              }
            />
          )}
        </Field>
        <Field label={t("story:language")} hint={t("story:aCodeSuchAsEnOr")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={s.language}
              onChange={(event) => set("language", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("story:intendedAudience")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={s.audience}
              onChange={(event) => set("audience", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("story:narrativeTone")}>
          {(id) => (
            <input
              id={id}
              className="control"
              placeholder={t("story:eGWarmAndCurious")}
              value={s.tone}
              onChange={(event) => set("tone", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("story:narrationStyle")}>
          {(id) => (
            <input
              id={id}
              className="control"
              placeholder={t("story:eGOneNarratorSecondPerson")}
              value={s.narrationStyle}
              onChange={(event) => set("narrationStyle", event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("story:numberOfScenes")}
          hint={t("story:emptyDecidedByEachSectionS")}
        >
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={200}
              className="control"
              value={s.sceneCount ?? ""}
              onChange={(event) =>
                set(
                  "sceneCount",
                  event.target.value === ""
                    ? null
                    : Math.max(
                        1,
                        Math.min(200, Math.round(Number(event.target.value))),
                      ),
                )
              }
            />
          )}
        </Field>
        <Field
          label={t("story:speakingRateWordsPerMinute")}
          hint={t("story:forEstimatesOnlyTheNarrationAudio")}
        >
          {(id) => (
            <input
              id={id}
              type="number"
              min={80}
              max={260}
              className="control"
              value={s.wordsPerMinute}
              onChange={(event) =>
                set(
                  "wordsPerMinute",
                  Math.max(
                    80,
                    Math.min(
                      260,
                      Math.round(Number(event.target.value)) || 150,
                    ),
                  ),
                )
              }
            />
          )}
        </Field>
      </div>
      <TextArea
        label={t("story:visualDirection")}
        value={s.visualDirection}
        onChange={(value) => set("visualDirection", value)}
      />
    </DetailBlock>
  );
}

function OutlineEditor({
  edit,
  onChange,
  onRegenerateSection,
  onExpandSection,
  busy,
}: {
  edit: StoryEditable;
  onChange(next: StoryEditable): void;
  onRegenerateSection(section: OutlineSection): void;
  onExpandSection(section: OutlineSection): void;
  busy: boolean;
}) {
  const outline = edit.outline;
  if (!outline) return null;
  const setOutline = (next: Partial<typeof outline>) =>
    onChange({ ...edit, outline: { ...outline, ...next } });
  const setSection = (index: number, next: Partial<OutlineSection>) =>
    setOutline({
      sections: outline.sections.map((section, at) =>
        at === index ? { ...section, ...next } : section,
      ),
    });
  return (
    <DetailBlock title={t("story:outline")}>
      <TextArea
        label={t("story:openingHook")}
        value={outline.hook}
        onChange={(hook) => setOutline({ hook })}
      />
      <TextArea
        label={t("story:mainPremise")}
        value={outline.premise}
        onChange={(premise) => setOutline({ premise })}
      />
      <TextArea
        label={t("story:centralQuestionsOnePerLine")}
        value={outline.centralQuestions.join("\n")}
        onChange={(value) => setOutline({ centralQuestions: lines(value) })}
      />
      <div className="flex flex-col gap-2">
        {outline.sections.map((section, index) => {
          const count = edit.scenes.filter(
            (scene) => scene.sectionId === section.id,
          ).length;
          const words = edit.scenes
            .filter((scene) => scene.sectionId === section.id)
            .reduce(
              (sum, scene) =>
                sum + (scene.narrationText.trim().match(/\S+/g)?.length ?? 0),
              0,
            );
          const budget = wordBudget(
            section.targetSeconds,
            edit.settings.wordsPerMinute,
          );
          const share = budget > 0 ? words / budget : 0;
          return (
            <div
              key={section.id}
              className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xs text-fg-dim tabular-nums">
                  {index + 1}
                </span>
                <input
                  aria-label={t("story:sectionTitle")}
                  className="control flex-1"
                  value={section.title}
                  onChange={(event) =>
                    setSection(index, { title: event.target.value })
                  }
                />
                <input
                  aria-label={t("story:sectionSeconds")}
                  type="number"
                  min={5}
                  max={3600}
                  className="control w-24"
                  value={section.targetSeconds}
                  onChange={(event) =>
                    setSection(index, {
                      targetSeconds: Math.max(
                        5,
                        Math.min(
                          3600,
                          Math.round(Number(event.target.value)) || 5,
                        ),
                      ),
                    })
                  }
                />
                <span className="text-2xs text-fg-dim">
                  {t("story:secondsAndScenes", { count })}
                </span>
                <IconButton
                  label={t("story:moveSectionUp")}
                  icon={ArrowUp}
                  size="sm"
                  onClick={() =>
                    setOutline({ sections: move(outline.sections, index, -1) })
                  }
                />
                <IconButton
                  label={t("story:moveSectionDown")}
                  icon={ArrowDown}
                  size="sm"
                  onClick={() =>
                    setOutline({ sections: move(outline.sections, index, 1) })
                  }
                />
                <span
                  className={cx(
                    "text-2xs tabular-nums",
                    count === 0
                      ? "text-fg-dim"
                      : share < 0.7
                        ? "text-warn"
                        : share > 1.4
                          ? "text-warn"
                          : "text-ok",
                  )}
                  title={t("story:wordsOfNarrationAgainstTheBudget")}
                >
                  {t("story:words", { words, budget })}
                </span>
                <IconButton
                  label={t("story:lengthenThisSectionSShortUnedited")}
                  icon={Sparkles}
                  size="sm"
                  disabled={busy || count === 0 || share >= 0.85}
                  onClick={() => onExpandSection(section)}
                />
                <IconButton
                  label={t("story:writeThisSectionSUnapprovedScenes")}
                  icon={RefreshCw}
                  size="sm"
                  disabled={busy}
                  onClick={() => onRegenerateSection(section)}
                />
                <IconButton
                  tone="danger"
                  label={t("story:removeSection")}
                  icon={Trash2}
                  size="sm"
                  onClick={async () => {
                    if (
                      count > 0 &&
                      !(await confirm({
                        title: t("story:removeThisSection"),
                        message: t("story:itsScenesAreRemovedToo", { count }),
                        confirmLabel: t("story:removeSection"),
                        tone: "danger",
                      }))
                    )
                      return;
                    onChange({
                      ...edit,
                      outline: {
                        ...outline,
                        sections: outline.sections.filter(
                          (item) => item.id !== section.id,
                        ),
                      },
                      scenes: edit.scenes.filter(
                        (scene) => scene.sectionId !== section.id,
                      ),
                    });
                  }}
                />
              </div>
              <TextArea
                label={t("story:purpose")}
                value={section.purpose}
                onChange={(purpose) => setSection(index, { purpose })}
              />
              <TextArea
                label={t("story:keyPointsOnePerLine")}
                value={section.keyPoints.join("\n")}
                onChange={(value) =>
                  setSection(index, { keyPoints: lines(value) })
                }
              />
              <TextArea
                label={t("story:supportingExamplesOnePerLine")}
                value={section.examples.join("\n")}
                onChange={(value) =>
                  setSection(index, { examples: lines(value) })
                }
              />
            </div>
          );
        })}
        <Button
          size="sm"
          icon={Plus}
          className="self-start"
          onClick={() =>
            setOutline({
              sections: [
                ...outline.sections,
                {
                  id: `sec-${crypto.randomUUID().slice(0, 8)}`,
                  title: t("story:newSection"),
                  purpose: "",
                  keyPoints: [],
                  examples: [],
                  targetSeconds: 60,
                },
              ],
            })
          }
        >
          {t("story:addSection")}
        </Button>
      </div>
      <TextArea
        label={t("story:endingOrConclusion")}
        value={outline.ending}
        onChange={(ending) => setOutline({ ending })}
      />
    </DetailBlock>
  );
}

const ORIGIN_TEXT = {
  get ai() {
    return t("story:aiSuggestion");
  },
  get "ai-edited"() {
    return t("story:aiSuggestionEdited");
  },
  get user() {
    return t("story:writtenByYou");
  },
} as const;

function SceneCard({
  scene,
  index,
  total,
  edit,
  onChange,
  onRegenerate,
  busy,
  warnings,
}: {
  scene: StoryScene;
  index: number;
  total: number;
  edit: StoryEditable;
  onChange(next: StoryEditable): void;
  onRegenerate(): void;
  busy: boolean;
  warnings: string[];
}) {
  const setScene = (next: Partial<StoryScene>) =>
    onChange({
      ...edit,
      scenes: edit.scenes.map((item) =>
        item.id === scene.id ? { ...item, ...next } : item,
      ),
    });
  const wpm = edit.settings.wordsPerMinute;
  const estimate = estimateNarrationSeconds(scene.narrationText, wpm);
  return (
    <article
      className={cx(
        "flex flex-col gap-2 rounded-lg border bg-surface p-3",
        scene.approved ? "border-ok/40" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-fg-dim tabular-nums">{index + 1}</span>
        <input
          aria-label={t("story:sceneTitle")}
          className="control min-w-48 flex-1"
          value={scene.title}
          onChange={(event) => setScene({ title: event.target.value })}
        />
        <Badge tone={scene.origin === "user" ? "neutral" : "accent"}>
          {ORIGIN_TEXT[scene.origin]}
        </Badge>
        <label className="flex items-center gap-1.5 text-xs text-fg">
          <input
            type="checkbox"
            checked={scene.approved}
            onChange={(event) => setScene({ approved: event.target.checked })}
          />
          {t("story:approved")}
        </label>
        <IconButton
          label={t("story:moveSceneUp")}
          icon={ArrowUp}
          size="sm"
          disabled={index === 0}
          onClick={() =>
            onChange({ ...edit, scenes: move(edit.scenes, index, -1) })
          }
        />
        <IconButton
          label={t("story:moveSceneDown")}
          icon={ArrowDown}
          size="sm"
          disabled={index === total - 1}
          onClick={() =>
            onChange({ ...edit, scenes: move(edit.scenes, index, 1) })
          }
        />
        <IconButton
          label={
            scene.approved
              ? t("story:approvedScenesAreNotWrittenAgain")
              : t("story:writeThisSceneAgain")
          }
          icon={RefreshCw}
          size="sm"
          disabled={busy || scene.approved}
          onClick={onRegenerate}
        />
        <IconButton
          tone="danger"
          label={t("story:removeScene")}
          icon={Trash2}
          size="sm"
          onClick={async () => {
            if (
              await confirm({
                title: t("story:removeThisScene"),
                message: t("story:itsNarrationAndNotesAreRemoved"),
                confirmLabel: t("story:removeScene"),
                tone: "danger",
              })
            ) {
              onChange({
                ...edit,
                scenes: edit.scenes.filter((item) => item.id !== scene.id),
              });
            }
          }}
        />
      </div>
      <TextArea
        label={t("story:narration")}
        rows={4}
        value={scene.narrationText}
        onChange={(narrationText) => setScene({ narrationText })}
        hint={t("story:aboutAtWordsPerMinuteEstimate", {
          estimate: formatClock(estimate),
          wpm,
        })}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextArea
          label={t("story:visualDescription")}
          value={scene.visualDescription}
          onChange={(visualDescription) => setScene({ visualDescription })}
        />
        <TextArea
          label={t("story:animationApproach")}
          value={scene.animationApproach}
          onChange={(animationApproach) => setScene({ animationApproach })}
        />
        <Field label={t("story:camera")}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={scene.cameraMotion}
              onChange={(event) =>
                setScene({
                  cameraMotion: event.target
                    .value as StoryScene["cameraMotion"],
                })
              }
            >
              {CAMERA_MOTIONS.map((motion) => (
                <option key={motion} value={motion}>
                  {motion.replace("_", " ")}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("story:transitionToTheNextScene")}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={scene.transition}
              onChange={(event) =>
                setScene({
                  transition: event.target.value as StoryScene["transition"],
                })
              }
            >
              {TRANSITIONS.map((transition) => (
                <option key={transition} value={transition}>
                  {transition}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("story:onScreenText")}>
          {(id) => (
            <input
              id={id}
              className="control"
              maxLength={300}
              value={scene.overlayText}
              onChange={(event) =>
                setScene({ overlayText: event.target.value })
              }
            />
          )}
        </Field>
        <Field
          label={t("story:plannedSeconds")}
          hint={t("story:emptyTheNarrationEstimate")}
        >
          {(id) => (
            <input
              id={id}
              type="number"
              min={0.5}
              max={600}
              step={0.5}
              className="control"
              value={scene.plannedSeconds ?? ""}
              placeholder={sceneSeconds(scene, wpm, 5).toFixed(1)}
              onChange={(event) =>
                setScene({
                  plannedSeconds:
                    event.target.value === ""
                      ? null
                      : Math.max(
                          0.5,
                          Math.min(600, Number(event.target.value)),
                        ),
                })
              }
            />
          )}
        </Field>
      </div>
      <TextArea
        label={t("story:productionNotes")}
        value={scene.productionNotes}
        onChange={(productionNotes) => setScene({ productionNotes })}
      />
      <TextArea
        label={t("story:missingAssetsAndRequirementsOnePer")}
        value={scene.missingAssets.join("\n")}
        onChange={(value) =>
          setScene({ missingAssets: lines(value).slice(0, 10) })
        }
      />
      <TextArea
        label={t("story:factsToCheckInIndependentSources")}
        value={scene.claims.join("\n")}
        onChange={(value) => setScene({ claims: lines(value).slice(0, 10) })}
      />
      {scene.researchRefs.length > 0 && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("story:researchUsedReferenceMaterialNotVerification", {
            scene: scene.researchRefs
              .map(
                (ref) =>
                  `${ref.kind}${ref.locator ? ` (${ref.locator})` : ""}: ${ref.excerpt ?? ""}`,
              )
              .join(" · "),
          })}
        </p>
      )}
      {warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-start gap-1.5 text-2xs leading-4 text-warn"
        >
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {warning}
        </p>
      ))}
    </article>
  );
}

export function StoryArchitect() {
  const story = useResearch((state) => state.story);
  const edit = useResearch((state) => state.storyEdit);
  const dirty = useResearch((state) => state.storyDirty);
  const llm = useResearch((state) => state.llm);
  const modelId = useResearch((state) => state.modelId);
  const chooseModel = useResearch((state) => state.chooseModel);
  const refreshLlm = useResearch((state) => state.refreshLlm);
  const editStory = useResearch((state) => state.editStory);
  const saveStory = useResearch((state) => state.saveStory);
  const generateStory = useResearch((state) => state.generateStory);
  const cancelStory = useResearch((state) => state.cancelStory);
  const reloadStory = useResearch((state) => state.reloadStory);
  const deleteStory = useResearch((state) => state.deleteStory);
  const createProductionProject = useResearch(
    (state) => state.createProductionProject,
  );
  const saving = useResearch((state) => state.busy.story ?? false);
  const job = useStudio((state) =>
    story?.generation.jobId
      ? state.jobs.find((item) => item.id === story.generation.jobId)
      : undefined,
  );
  const openProject = useStudio((state) => state.openProject);
  const refreshProjects = useStudio((state) => state.refreshProjects);
  const setTab = useStudio((state) => state.setTab);
  const [reviewed, setReviewed] = useState(false);
  const [newSceneSection, setNewSceneSection] = useState<string>("");

  useEffect(() => {
    void refreshLlm();
  }, [refreshLlm]);
  // The job's own updates drive the view.
  const jobStep = job ? `${job.status}:${job.progressMessage ?? ""}` : "";
  useEffect(() => {
    if (jobStep) void reloadStory();
  }, [jobStep]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!story || !edit) return null;
  const active = ACTIVE.has(story.generation.status);
  const usableModels =
    llm?.models.filter(
      (model) =>
        model.installation === "installed" || model.installation === "external",
    ) ?? [];
  const runtimeProblem = !llm
    ? t("story:checkingTheLanguageModel")
    : !llm.runtime.available
      ? (llm.runtime.reason ?? t("story:theRuntimeIsNotSetUp"))
      : usableModels.length === 0
        ? t("story:downloadALanguageModelInAi")
        : null;
  const blocking = story.warnings.filter(
    (warning) => warning.severity === "blocking",
  );
  const sceneWarnings = (id: string) =>
    story.warnings
      .filter((warning) => warning.sceneId === id)
      .map((warning) => warning.message);
  const openInEditor = async (projectId: string, episodeId: string) => {
    await refreshProjects();
    await openProject(projectId, { episodeId });
    setTab("scenes");
  };
  const concept = story.concept;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xs tracking-wide text-fg-dim uppercase">
            {t("story:storyArchitectRevision", { revision: story.revision })}
          </p>
          <h2 className="text-base font-semibold tracking-tight text-fg">
            {edit.settings.title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            icon={Save}
            busy={saving}
            disabled={!dirty || active}
            onClick={() => void saveStory()}
          >
            {dirty ? t("story:saveDraft") : t("story:saved")}
          </Button>
          <IconButton
            tone="danger"
            label={t("story:deleteThisDraft")}
            icon={Trash2}
            disabled={active}
            onClick={async () => {
              if (
                await confirm({
                  title: t("story:deleteThisStoryDraft"),
                  message: t("story:theDraftAndItsHistoryAre"),
                  confirmLabel: t("story:deleteDraft"),
                  tone: "danger",
                })
              ) {
                await deleteStory();
              }
            }}
          />
        </div>
      </header>

      <DetailBlock title={t("story:conceptAnAiSuggestionFromThe")}>
        <p className="text-xs leading-5 text-fg">{concept.premise}</p>
        <p className="text-2xs leading-4 text-fg-dim">
          {t("story:angleAudienceResearchStillRequired", {
            angle: concept.angle,
            audience: concept.audience,
          })}{" "}
          {concept.researchNeeded.join("; ") || t("story:noneNamed")} ·{" "}
          {t("story:researchNotes", { count: concept.evidence.length })}
        </p>
        {story.sourceChanged && (
          <p className="text-2xs text-warn">
            {t("story:theResearchBehindThisConceptHas")}
          </p>
        )}
      </DetailBlock>

      {story.handoff && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-ok/30 bg-ok/5 p-3">
          <p className="text-xs text-fg">
            {t("story:aProductionProjectWasCreatedFrom", {
              revision: story.handoff.revision,
              createdAt: formatDate(story.handoff.createdAt),
            })}
          </p>
          <Button
            size="sm"
            icon={Clapperboard}
            onClick={() =>
              void openInEditor(
                story.handoff?.productionProjectId ?? "",
                story.handoff?.episodeId ?? "",
              )
            }
          >
            {t("story:openInEditor")}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 card-surface rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("story:languageModel")}
            className="control w-auto min-w-56"
            value={modelId ?? ""}
            onChange={(event) => chooseModel(event.target.value)}
            disabled={active}
          >
            {(llm?.models ?? []).map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={edit.outline ? "secondary" : "primary"}
            icon={ListTree}
            disabled={active || runtimeProblem !== null}
            onClick={async () => {
              if (
                edit.scenes.some((scene) => !scene.approved) &&
                !(await confirm({
                  title: t("story:planANewOutline"),
                  message: t("story:unapprovedScenesBelongToTheCurrent"),
                  confirmLabel: t("story:planNewOutline"),
                }))
              )
                return;
              await generateStory({ kind: "outline" });
            }}
          >
            {edit.outline ? t("story:newOutline") : t("story:generateOutline")}
          </Button>
          <Button
            size="sm"
            variant={
              edit.outline && edit.scenes.length === 0 ? "primary" : "secondary"
            }
            icon={Sparkles}
            disabled={active || runtimeProblem !== null || !edit.outline}
            onClick={() => void generateStory({ kind: "script" })}
          >
            {t("story:writeScenesForEmptySections")}
          </Button>
          {active && (
            <Button size="sm" icon={Square} onClick={() => void cancelStory()}>
              {t("story:cancel")}
            </Button>
          )}
        </div>
        <p className="text-2xs leading-4 text-fg-dim">
          {runtimeProblem ?? t("story:runsOnThisComputerWithThe")}
        </p>
        {active && (
          <div role="status" className="flex flex-col gap-1">
            <p className="text-xs text-fg">
              {story.generation.step ?? t("story:waitingInTheQueue")}
            </p>
            <ProgressBar value={job?.progress ?? null} />
          </div>
        )}
        {!active && story.generation.error && (
          <p className="text-xs text-danger">{story.generation.error}</p>
        )}
        {!active && story.generation.status === "cancelled" && (
          <p className="text-xs text-fg-muted">
            {t("story:cancelledFinishedStepsWereKept")}
          </p>
        )}
      </div>

      <fieldset disabled={active} className="flex min-w-0 flex-col gap-4">
        <SettingsForm
          edit={edit}
          change={(settings) => editStory((draft) => ({ ...draft, settings }))}
        />
        <OutlineEditor
          edit={edit}
          busy={active || runtimeProblem !== null}
          onChange={(next) => editStory(() => next)}
          onExpandSection={(section) =>
            void generateStory({ kind: "expand", sectionId: section.id })
          }
          onRegenerateSection={async (section) => {
            const approved = edit.scenes.filter(
              (scene) => scene.sectionId === section.id && scene.approved,
            ).length;
            if (
              await confirm({
                title: t("story:writeAgain", { title: section.title }),
                message:
                  approved > 0
                    ? t("story:unapprovedReplacedApprovedStay", {
                        count: approved,
                      })
                    : t("story:unapprovedReplaced"),
                confirmLabel: t("story:writeAgain2"),
              })
            ) {
              await generateStory({ kind: "section", sectionId: section.id });
            }
          }}
        />

        {edit.outline && (
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="eyebrow">
                {t("story:scenes", { edit: edit.scenes.length })}
              </h3>
              <span className="text-2xs text-fg-dim">
                {t("story:aboutOfEstimate", {
                  reduce: formatClock(
                    edit.scenes.reduce(
                      (sum, scene) =>
                        sum +
                        sceneSeconds(scene, edit.settings.wordsPerMinute, 5),
                      0,
                    ),
                  ),
                  targetDurationSeconds: formatClock(
                    edit.settings.targetDurationSeconds,
                  ),
                })}
              </span>
            </div>
            {edit.scenes.map((scene, index) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                index={index}
                total={edit.scenes.length}
                edit={edit}
                busy={active || runtimeProblem !== null}
                warnings={sceneWarnings(scene.id)}
                onChange={(next) => editStory(() => next)}
                onRegenerate={() =>
                  void generateStory({ kind: "scene", sceneId: scene.id })
                }
              />
            ))}
            <div className="flex items-center gap-2">
              <select
                aria-label={t("story:sectionForTheNewScene")}
                className="control w-auto"
                value={newSceneSection || edit.outline.sections[0]?.id || ""}
                onChange={(event) => setNewSceneSection(event.target.value)}
              >
                {edit.outline.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                icon={Plus}
                disabled={edit.outline.sections.length === 0}
                onClick={() =>
                  editStory((draft) => ({
                    ...draft,
                    scenes: [
                      ...draft.scenes,
                      {
                        id: crypto.randomUUID(),
                        sectionId:
                          newSceneSection ||
                          draft.outline?.sections[0]?.id ||
                          "",
                        title: t("story:newScene"),
                        narrationText: "",
                        visualDescription: "",
                        animationApproach: "",
                        cameraMotion: "static",
                        cameraInstructions: "",
                        overlayText: "",
                        transition: "cut",
                        productionNotes: "",
                        missingAssets: [],
                        claims: [],
                        researchRefs: [],
                        plannedSeconds: null,
                        approved: false,
                        origin: "user",
                      },
                    ],
                  }))
                }
              >
                {t("story:addScene")}
              </Button>
            </div>
          </section>
        )}
      </fieldset>

      <DetailBlock
        title={t("story:reviewBeforeProduction", {
          story: story.warnings.length,
        })}
      >
        {dirty && (
          <p className="text-xs text-warn">
            {t("story:saveTheDraftToReviewIt")}
          </p>
        )}
        {story.warnings.length === 0 ? (
          <p className="text-xs text-fg-muted">
            {t("story:nothingFlaggedFactsInTheNarration")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {story.warnings.map((warning) => (
              <li
                key={warning.id}
                className={cx(
                  "text-xs leading-5",
                  warning.severity === "blocking"
                    ? "text-danger"
                    : warning.severity === "warning"
                      ? "text-warn"
                      : "text-fg-muted",
                )}
              >
                <span className="font-medium">
                  {warning.severity === "blocking"
                    ? t("story:mustFix")
                    : warning.kind.replace("-", " ")}
                  :{" "}
                </span>
                {warning.message}
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-start gap-2 rounded-md border border-line bg-canvas p-2.5 text-xs leading-5 text-fg">
          <input
            type="checkbox"
            className="mt-1"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          {t("story:iReviewedThisDraftAndIts")}
        </label>
        <Button
          variant="primary"
          icon={Clapperboard}
          busy={saving}
          disabled={
            active ||
            dirty ||
            !reviewed ||
            blocking.length > 0 ||
            Boolean(story.handoff)
          }
          className="self-start"
          onClick={async () => {
            if (
              !(await confirm({
                title: t("story:createTheProductionProject"),
                message: t("story:aNewProjectWithOneEpisode", {
                  edit: edit.scenes.length,
                }),
                confirmLabel: t("story:createProject"),
              }))
            )
              return;
            const created = await createProductionProject();
            if (created)
              await openInEditor(created.projectId, created.episodeId);
          }}
        >
          {t("story:createProductionProject")}
        </Button>
        <p className="text-2xs text-fg-dim">
          {story.handoff
            ? t("story:alreadyCreatedOpenItAbove")
            : blocking.length > 0
              ? t("story:fixTheItemsMarkedMustFix")
              : dirty
                ? t("story:saveTheDraftFirst")
                : !reviewed
                  ? t("story:confirmTheReviewFirst")
                  : t("story:ready")}
        </p>
      </DetailBlock>
    </div>
  );
}
