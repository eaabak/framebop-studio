import {
  type BlueprintScene,
  PRODUCTION_METHOD_LABELS,
  PRODUCTION_METHODS,
  type ProductionMethod,
  formatClock,
} from "@framebop/core";
import {
  AudioLines,
  Clapperboard,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Image as ImageIcon,
  Play,
  Ruler,
  Sparkles,
  Video,
} from "lucide-react";
import { type ReactNode, Suspense, lazy, useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Spinner,
  cx,
} from "../components/ui";
import { useBlueprint } from "../store/blueprint";
import { useResearch } from "../store/research";
import { useStudio } from "../store/studio";
// PixiJS is large, so the animation preview loads only when it is shown.
const AnimationPreview = lazy(() =>
  import("./AnimationPreview").then((module) => ({
    default: module.AnimationPreview,
  })),
);
import { DetailBlock } from "./models/shared";
import { MediaProduction } from "./blueprint/MediaProduction";
import { AnimationDirector } from "./AnimationDirector";
import { currentLanguage, t } from "../i18n";

const SOURCE_TEXT = {
  estimate: "estimated",
  manual: "set by you",
  audio: "from narration audio",
} as const;

function Lines({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string[];
  onCommit(value: string[]): void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value.join("\n"));
  useEffect(() => setDraft(value.join("\n")), [value]);
  return (
    <label className="flex flex-col gap-1 text-2xs text-fg-dim">
      {label}
      <textarea
        rows={2}
        className="control resize-y text-xs"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          if (next.join("\n") !== value.join("\n")) onCommit(next);
        }}
      />
    </label>
  );
}

function Media({
  present,
  icon: Icon,
  label,
}: {
  present: boolean;
  icon: typeof ImageIcon;
  label: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-2xs",
        present ? "text-ok" : "text-fg-dim",
      )}
      title={
        present
          ? `${label} present`
          : t("blueprint:noYet", { toLowerCase: label.toLowerCase() })
      }
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

function SceneRow({
  scene,
  modelId,
}: {
  scene: BlueprintScene;
  modelId: string | null;
}) {
  const blueprint = useBlueprint((state) => state.blueprint);
  const busy = useBlueprint((state) => state.busy[scene.sceneId] ?? false);
  const updatePlan = useBlueprint((state) => state.updatePlan);
  const applyAnimation = useBlueprint((state) => state.applyAnimation);
  const previewNarration = useBlueprint((state) => state.previewNarration);
  const applyPreview = useBlueprint((state) => state.applyPreview);
  const useMeasured = useBlueprint((state) => state.useMeasured);
  const suggestNarration = useBlueprint((state) => state.suggestNarration);
  const acceptNarration = useBlueprint((state) => state.acceptNarration);
  const discardNarration = useBlueprint((state) => state.discardNarration);
  const openEpisode = useStudio((state) => state.openEpisode);
  const setTab = useStudio((state) => state.setTab);
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const proposalJob = useStudio((state) =>
    scene.plan.proposalJobId
      ? state.jobs.find((job) => job.id === scene.plan.proposalJobId)
      : undefined,
  );
  const methods = blueprint?.methods ?? [];
  const method = methods.find((item) => item.method === scene.plan.method);
  const plan = scene.plan;
  const narration = scene.narration;
  const measured = narration.measuredSeconds;
  const mismatch =
    measured !== null
      ? measured > scene.durationSeconds + 0.5 ||
        measured < scene.durationSeconds * 0.7
      : narration.words > 0 &&
        Math.abs(narration.estimatedSeconds - scene.durationSeconds) >
          Math.max(2, scene.durationSeconds * 0.35);
  const writing =
    proposalJob && ["pending", "running"].includes(proposalJob.status);
  const [producing, setProducing] = useState(false);

  return (
    <article className="flex flex-col gap-2 card-surface rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-fg-dim tabular-nums">
          {scene.index + 1}
        </span>
        <button
          type="button"
          className="text-ui font-medium text-fg hover:text-accent"
          onClick={async () => {
            if (activeEpisodeId)
              await openEpisode(activeEpisodeId, scene.sceneId);
            setTab("scenes");
          }}
        >
          {scene.title || t("blueprint:untitledScene")}
        </button>
        <span className="text-2xs text-fg-dim">
          {formatClock(scene.durationSeconds)} (
          {SOURCE_TEXT[plan.durationSource]})
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Media
            present={scene.media.image}
            icon={ImageIcon}
            label={t("blueprint:image")}
          />
          <Media
            present={scene.media.video}
            icon={Video}
            label={t("blueprint:video")}
          />
          <Media
            present={scene.media.audio}
            icon={AudioLines}
            label={t("blueprint:narration")}
          />
        </span>
      </div>

      <p
        className={cx(
          "text-2xs leading-4",
          mismatch ? "text-warn" : "text-fg-dim",
        )}
      >
        {t("blueprint:narrationWordsAboutAtWordsPer", {
          words: narration.words,
          estimatedSeconds: formatClock(narration.estimatedSeconds),
          wordsPerMinute: blueprint?.wordsPerMinute,
        })}
        {measured !== null && (
          <>{t("blueprint:measuredS", { measured: measured.toFixed(1) })}</>
        )}
        {narration.previewSeconds !== null && (
          <>
            {t("blueprint:previewSNotInTheScene", {
              narration: narration.previewSeconds.toFixed(1),
            })}
          </>
        )}
        {mismatch && t("blueprint:doesNotMatchTheSceneS")}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-2xs text-fg-dim">
          {t("blueprint:productionMethod")}
          <select
            className="control text-xs"
            value={plan.method}
            disabled={busy}
            onChange={(event) =>
              void updatePlan(scene.sceneId, {
                method: event.target.value as ProductionMethod,
              })
            }
          >
            {PRODUCTION_METHODS.map((value) => {
              const availability = methods.find(
                (item) => item.method === value,
              );
              // A method whose engine only needs setting up stays selectable:
              // the Media Production panel is where it is set up.
              const settable =
                !availability?.available &&
                (availability?.engines.length ?? 0) > 0;
              return (
                <option
                  key={value}
                  value={value}
                  disabled={
                    !availability?.available &&
                    !settable &&
                    value !== plan.method
                  }
                >
                  {value === "text-to-video"
                    ? t("media:textToVideo")
                    : PRODUCTION_METHOD_LABELS[value]}
                  {availability?.available
                    ? ""
                    : settable
                      ? t("blueprint:needsSetup")
                      : t("blueprint:notAvailable")}
                </option>
              );
            })}
          </select>
          <span
            className={cx(
              "leading-4",
              method?.available ? "text-fg-dim" : "text-warn",
            )}
          >
            {method?.reason}
          </span>
        </label>
        {method &&
        method.engines.length > 0 &&
        ["image-generation", "image-to-video", "text-to-video"].includes(
          plan.method,
        ) ? (
          <label className="flex flex-col gap-1 text-2xs text-fg-dim">
            {t("blueprint:engine")}
            <select
              className="control text-xs"
              value={plan.engineId ?? ""}
              disabled={busy}
              onChange={(event) =>
                void updatePlan(scene.sceneId, {
                  engineId: event.target.value || null,
                })
              }
            >
              <option value="">{t("blueprint:firstAvailable")}</option>
              {method.engines.map((engine) => (
                <option
                  key={engine.id}
                  value={engine.id}
                  disabled={!engine.available}
                >
                  {engine.name}
                  {engine.maturity === "experimental" ? " (experimental)" : ""}
                  {engine.available ? "" : t("blueprint:notAvailable")}
                </option>
              ))}
            </select>
          </label>
        ) : plan.method === "layered-2d" ? (
          <div className="flex flex-col items-start gap-1 text-2xs leading-4 text-fg-dim">
            <span>{t("blueprint:animation")}</span>
            {plan.animation?.renderer === "lab" ? (
              <p>{t("blueprint:labWhichPathWinsHint")}</p>
            ) : plan.animation ? (
              <p>
                {t("blueprint:charactersLayersSTimelineAfterIt", {
                  plan: plan.animation.characters.length,
                  plan2: plan.animation.layers.length,
                  plan3: (
                    plan.animation.durationFrames / plan.animation.fps
                  ).toFixed(1),
                })}
              </p>
            ) : (
              <p className="text-warn">{t("blueprint:noAnimationChosenYet")}</p>
            )}
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                icon={Clapperboard}
                disabled={busy}
                onClick={() =>
                  void applyAnimation(scene.sceneId, "roman-street")
                }
              >
                {t("blueprint:vectorRomanStreet")}
              </Button>
              <Button
                size="sm"
                icon={Clapperboard}
                disabled={busy}
                title={t("blueprint:pixijsWithPaintedLayersAndA")}
                onClick={() =>
                  void applyAnimation(scene.sceneId, "roman-street-sprites")
                }
              >
                {t("blueprint:paintedStreetPixijsTestArt")}
              </Button>
              <Button
                size="sm"
                icon={FlaskConical}
                disabled={busy}
                title={t("blueprint:labWhichPathWinsHint")}
                onClick={() =>
                  void applyAnimation(scene.sceneId, "lab-which-path")
                }
              >
                {t("blueprint:labWhichPathWins")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-2xs leading-4 text-fg-dim">
            <p>
              {t("blueprint:visual")}{" "}
              {scene.visualDescription || t("blueprint:noDescriptionYet")}
            </p>
            {scene.motionPrompt && (
              <p>
                {t("blueprint:animation2", {
                  motionPrompt: scene.motionPrompt,
                })}
              </p>
            )}
            <p>
              {t("blueprint:cameraTransition", {
                scene: scene.cameraMotion.replace("_", " "),
                transition: scene.transition,
              })}
            </p>
          </div>
        )}
        <Lines
          label={t("blueprint:requiredAssetsOnePerLine")}
          value={plan.requiredAssets}
          onCommit={(requiredAssets) =>
            void updatePlan(scene.sceneId, { requiredAssets })
          }
        />
        <Lines
          label={t("blueprint:factsToCheckInIndependentSources")}
          value={plan.claims}
          onCommit={(claims) => void updatePlan(scene.sceneId, { claims })}
        />
      </div>
      {plan.method === "layered-2d" && (
        <AnimationDirector
          sceneId={scene.sceneId}
          built={plan.animation?.director ?? null}
        />
      )}
      {plan.method === "layered-2d" && plan.animation && (
        <Suspense fallback={<Spinner />}>
          <AnimationPreview sceneId={scene.sceneId} version={plan.updatedAt} />
        </Suspense>
      )}
      {producing && <MediaProduction blueprintScene={scene} />}
      {plan.research.length > 0 && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("blueprint:researchUsedReferenceMaterialNotVerification", {
            plan: plan.research
              .map(
                (ref) => `${ref.kind}${ref.locator ? ` (${ref.locator})` : ""}`,
              )
              .join(" · "),
          })}
        </p>
      )}

      {plan.proposedNarration && (
        <div className="flex flex-col gap-1.5 rounded-md border border-accent/30 bg-accent/5 p-2">
          <p className="text-2xs text-fg-dim">
            {t("blueprint:suggestedLongerNarrationAiNotIn")}
          </p>
          <p
            data-selectable
            className="text-xs leading-5 whitespace-pre-wrap text-fg"
          >
            {plan.proposedNarration}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              busy={busy}
              onClick={() => void acceptNarration(scene.sceneId)}
            >
              {t("blueprint:useThisNarration")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void discardNarration(scene.sceneId)}
            >
              {t("blueprint:discard")}
            </Button>
          </div>
        </div>
      )}
      {proposalJob?.status === "failed" && !plan.proposedNarration && (
        <p className="text-2xs text-warn">
          {t("blueprint:theLastSuggestionWasNotUsable", {
            message: proposalJob.error?.message,
          })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={ImageIcon}
          aria-expanded={producing}
          variant={producing ? "primary" : "secondary"}
          onClick={() => setProducing((open) => !open)}
        >
          {producing ? t("media:hidePanel") : t("media:showPanel")}
        </Button>
        <Button
          size="sm"
          icon={Play}
          busy={busy}
          disabled={!scene.narrationText.trim()}
          onClick={() => void previewNarration(scene.sceneId)}
        >
          {t("blueprint:previewNarration")}
        </Button>
        {narration.previewJobId && (
          <Button
            size="sm"
            icon={AudioLines}
            disabled={busy}
            onClick={() => void applyPreview(narration.previewJobId as string)}
          >
            {t("blueprint:putThePreviewInTheScene")}
          </Button>
        )}
        {measured !== null && plan.durationSource !== "audio" && (
          <Button
            size="sm"
            icon={Ruler}
            disabled={busy}
            onClick={() => void useMeasured(scene.sceneId)}
          >
            {t("blueprint:useMeasuredLengthS", {
              measured: measured.toFixed(1),
            })}
          </Button>
        )}
        <Button
          size="sm"
          icon={Sparkles}
          busy={Boolean(writing)}
          disabled={
            busy || !modelId || !scene.narrationText.trim() || Boolean(writing)
          }
          title={modelId ? undefined : t("blueprint:setUpALocalLanguageModel")}
          onClick={() =>
            modelId && void suggestNarration(scene.sceneId, modelId)
          }
        >
          {writing
            ? t("blueprint:writingALongerVersion")
            : t("blueprint:suggestLongerNarration")}
        </Button>
      </div>
    </article>
  );
}

function Summary({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-fg">
      {children}
    </div>
  );
}

export function BlueprintView() {
  const episodeId = useStudio((state) => state.activeEpisodeId);
  const jobs = useStudio((state) => state.jobs);
  const {
    blueprint,
    loading,
    error,
    preflight,
    checking,
    load,
    reload,
    runPreflight,
  } = useBlueprint();
  const llm = useResearch((state) => state.llm);
  const modelId = useResearch((state) => state.modelId);
  const refreshLlm = useResearch((state) => state.refreshLlm);

  useEffect(() => {
    if (episodeId) void load(episodeId);
  }, [episodeId, load]);
  useEffect(() => {
    void refreshLlm();
  }, [refreshLlm]);
  // Finished narration and suggestion jobs change what the blueprint shows.
  const jobKey = jobs
    .filter(
      (job) =>
        job.episodeId === episodeId &&
        ["audio_generation", "story_generation"].includes(job.type),
    )
    .map((job) => `${job.id}:${job.status}`)
    .join(",");
  useEffect(() => {
    if (jobKey) void reload();
  }, [jobKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!episodeId) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={t("blueprint:noEpisodeOpen")}
        description={t("blueprint:openAnEpisodeToPlanIts")}
      />
    );
  }
  if (error)
    return <ErrorState message={error} onRetry={() => void load(episodeId)} />;
  if (loading || !blueprint) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const usableModel =
    llm?.runtime.available &&
    llm.models.some(
      (model) =>
        model.modelId === modelId &&
        (model.installation === "installed" ||
          model.installation === "external"),
    )
      ? modelId
      : null;
  const groups = [
    ["blocking", t("blueprint:technicalProblems"), "text-danger"],
    ["pending", t("blueprint:mediaStillToMake"), "text-fg-muted"],
    ["editorial", t("blueprint:forYouToReview"), "text-warn"],
  ] as const;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">
              {t("blueprint:productionBlueprint")}
            </h1>
            <p className="text-xs text-fg-muted">
              {t("blueprint:howEachSceneWillBeMade")}
            </p>
          </div>
          <Button
            icon={ClipboardCheck}
            busy={checking}
            onClick={() => void runPreflight()}
          >
            {t("blueprint:runPreflight")}
          </Button>
        </header>

        <div className="grid grid-cols-4 gap-2">
          <Summary>
            <span className="text-2xs text-fg-dim">
              {t("blueprint:target")}
            </span>
            {formatClock(blueprint.targetSeconds)}
          </Summary>
          <Summary>
            <span className="text-2xs text-fg-dim">
              {t("blueprint:plannedSceneLengths")}
            </span>
            {formatClock(blueprint.plannedSeconds)}
          </Summary>
          <Summary>
            <span className="text-2xs text-fg-dim">
              {t("blueprint:narrationEstimateWpm", {
                wordsPerMinute: blueprint.wordsPerMinute,
              })}
            </span>
            {formatClock(blueprint.estimatedNarrationSeconds)}
          </Summary>
          <Summary>
            <span className="text-2xs text-fg-dim">
              {t("blueprint:measuredNarration")}
            </span>
            {blueprint.measuredNarrationSeconds !== null
              ? t("blueprint:scenesWithAudio", {
                  measuredNarrationSeconds: formatClock(
                    blueprint.measuredNarrationSeconds,
                  ),
                })
              : t("blueprint:noNarrationAudioYet")}
          </Summary>
        </div>

        {blueprint.sections.length > 0 && (
          <DetailBlock title={t("blueprint:sectionsOfTheStoryDraft")}>
            <ul className="flex flex-col gap-1 text-xs">
              {blueprint.sections.map((section) => (
                <li key={section.title} className="flex justify-between gap-3">
                  <span className="text-fg">{section.title}</span>
                  <span className="text-fg-dim tabular-nums">
                    {t("blueprint:scenesPlannedNarrationAbout", {
                      section: section.sceneIds.length,
                      plannedSeconds: formatClock(section.plannedSeconds),
                      estimatedSeconds: formatClock(section.estimatedSeconds),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </DetailBlock>
        )}

        {preflight && (
          <DetailBlock
            title={t("blueprint:preflight", {
              toLocaleTimeString: new Date(
                preflight.checkedAt,
              ).toLocaleTimeString(currentLanguage()),
            })}
          >
            <div className="flex gap-2">
              <Badge tone={preflight.readyToProduce ? "ok" : "danger"}>
                {preflight.readyToProduce
                  ? t("blueprint:readyToProduce")
                  : t("blueprint:notReadyToProduce")}
              </Badge>
              <Badge tone={preflight.readyToRender ? "ok" : "neutral"}>
                {preflight.readyToRender
                  ? t("blueprint:readyToRender")
                  : t("blueprint:notReadyToRender")}
              </Badge>
            </div>
            {groups.map(([level, title, tone]) => {
              const issues = preflight.issues.filter(
                (issue) => issue.level === level,
              );
              if (issues.length === 0) return null;
              return (
                <div key={level} className="flex flex-col gap-1">
                  <p
                    className={cx(
                      "text-2xs font-semibold tracking-wide uppercase",
                      tone,
                    )}
                  >
                    {title} ({issues.length})
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {issues.map((issue) => (
                      <li
                        key={issue.id}
                        className="text-xs leading-5 text-fg-muted"
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </DetailBlock>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="eyebrow">
            {t("blueprint:scenes", { blueprint: blueprint.scenes.length })}
          </h2>
          {!usableModel && (
            <p className="text-2xs text-fg-dim">
              {t("blueprint:longerNarrationSuggestionsNeedALocal")}
            </p>
          )}
          {blueprint.scenes.map((scene) => (
            <SceneRow key={scene.sceneId} scene={scene} modelId={usableModel} />
          ))}
        </section>
      </div>
    </div>
  );
}
