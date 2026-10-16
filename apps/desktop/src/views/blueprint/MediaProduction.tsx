/**
 * The Media Production workspace of one scene in the Production Blueprint:
 * choose how its picture is made, run a generation, compare the attempts and
 * put the chosen one into the scene. Nothing runs without a click, and each
 * scene is produced on its own.
 */
import {
  type Asset,
  type BlueprintScene,
  type EngineCapability,
  type EngineStatus,
  type ImageRuntimeStatus,
  type Job,
  type MediaVerification,
  type ModelChoice,
  type ParameterValue,
  type Scene,
  composeGenerationPrompt,
  formatDuration,
  isActiveJob,
} from "@framebop/core";
import { Film, ImagePlus, RotateCcw, Ruler, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModelPicker } from "../../components/ModelPicker";
import { CapabilitySummary } from "../../components/engines";
import { canStop, jobRunSeconds, useNow } from "../../components/jobs";
import { AssetThumb } from "../../components/media";
import { Badge, Button, Field, ProgressBar, cx } from "../../components/ui";
import { formatBytes, formatDateTime, t } from "../../i18n";
import { progressText } from "../../lib/jobLabels";
import { bridge } from "../../lib/bridge";
import { errorMessage } from "../../lib/errors";
import { confirm, openMediaPreview } from "../../lib/dialogs";
import { useBlueprint } from "../../store/blueprint";
import { useReferences } from "../../store/references";
import { useStudio } from "../../store/studio";
import { ParameterField } from "../scenes/GenerateSection";
import { ReferenceManager } from "./ReferenceManager";

type Task = "image_generation" | "video_generation";
type Slot = "image" | "video";

/** The phases of a generation, as the panel shows them. */
type GenerationStage =
  "queued" | "preparing" | "loading_model" | "generating" | "validating";

const STAGES: readonly GenerationStage[] = [
  "queued",
  "preparing",
  "loading_model",
  "generating",
  "validating",
];

const stageLabel = (stage: GenerationStage) =>
  ({
    queued: t("media:stageQueued"),
    preparing: t("media:stagePreparing"),
    loading_model: t("media:stageLoadingModel"),
    generating: t("media:stageGenerating"),
    validating: t("media:stageValidating"),
  })[stage];

const modeLabel = (mode: unknown) =>
  mode === "image-to-image"
    ? t("media:imageToImage")
    : mode === "image-to-video"
      ? t("media:imageToVideo")
      : mode === "text-to-video"
        ? t("media:textToVideo")
        : t("media:textToImage");

/** Fit-for-purpose status of an engine, in the words the panel uses. */
function EngineState({ capability }: { capability: EngineCapability }) {
  if (!capability.available) {
    return <Badge tone="danger">{t("media:statusUnavailable")}</Badge>;
  }
  if (capability.maturity === "test") {
    return <Badge tone="warn">{t("media:statusTest")}</Badge>;
  }
  if (capability.maturity === "experimental") {
    return <Badge tone="warn">{t("media:statusExperimental")}</Badge>;
  }
  return <Badge tone="ok">{t("media:statusVerified")}</Badge>;
}

/** Queued → Preparing → Loading model → Generating → Validating. */
function StageSteps({ job }: { job: Job }) {
  const current =
    job.status === "pending" ? "queued" : (job.stage ?? "preparing");
  const reached = STAGES.indexOf(current as GenerationStage);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-2xs">
      {STAGES.map((stage, index) => (
        <li
          key={stage}
          aria-current={index === reached ? "step" : undefined}
          className={cx(
            "rounded px-1.5 py-0.5",
            index === reached
              ? "bg-accent/15 font-medium text-accent"
              : index < reached
                ? "text-fg-muted"
                : "text-fg-dim",
          )}
        >
          {stageLabel(stage)}
        </li>
      ))}
    </ol>
  );
}

export function ActiveRun({ job }: { job: Job }) {
  const cancelJob = useStudio((state) => state.cancelJob);
  const now = useNow(job.status === "running");
  const seconds = jobRunSeconds(job, now);
  const stoppable = canStop(job);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-2.5">
      <StageSteps job={job} />
      <ProgressBar value={job.status === "pending" ? 0 : job.progress} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fg-muted">
        <span className="tabular-nums">
          {seconds !== null &&
            t("media:elapsed", { time: formatDuration(seconds) })}
          {job.progressMessage && ` · ${progressText(job.progressMessage)}`}
        </span>
        <Button
          size="sm"
          icon={X}
          disabled={!stoppable || job.cancelRequestedAt !== null}
          title={stoppable ? undefined : t("media:cannotStop")}
          onClick={() => void cancelJob(job.id)}
        >
          {job.status === "pending"
            ? t("media:removeFromQueue")
            : t("media:stop")}
        </Button>
      </div>
      {job.status === "running" && job.metadata.reportsProgress === false && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("media:noProgress")}
        </p>
      )}
    </div>
  );
}

function VerificationLine({ job }: { job: Job }) {
  const verification = job.output?.verification as MediaVerification | null;
  if (!verification) return null;
  const facts = [
    verification.width && verification.height
      ? `${verification.width} × ${verification.height}`
      : null,
    verification.durationSeconds !== null && verification.fps !== null
      ? t("media:durationAtFps", {
          seconds: verification.durationSeconds.toFixed(1),
          fps: Math.round(verification.fps * 100) / 100,
        })
      : null,
    verification.frames !== null
      ? t("media:frames", { count: verification.frames })
      : null,
    verification.codec,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-0.5 text-2xs leading-4 text-fg-muted">
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone={verification.status === "passed" ? "ok" : "warn"}>
          {verification.status === "passed"
            ? t("media:verificationPassed")
            : t("media:verificationPartial")}
        </Badge>
        {facts.join(" · ")}
      </span>
      {verification.similarity && (
        <span title={t("media:similarityNote")}>
          {t("media:similarity", {
            first: verification.similarity.first?.toFixed(2) ?? "–",
            last: verification.similarity.last?.toFixed(2) ?? "–",
          })}
        </span>
      )}
    </div>
  );
}

function ResultDetails({ job, asset }: { job: Job; asset: Asset | null }) {
  const input = job.input;
  const rows: [string, string][] = [
    [t("media:detailEngine"), String(job.metadata.engineName ?? job.adapterId)],
    [t("media:detailModel"), job.model ?? t("media:chosenByEngine")],
    [t("media:detailMode"), modeLabel(input.mode)],
    [t("media:detailPrompt"), String(input.prompt ?? "")],
    ...(input.negativePrompt
      ? [
          [t("media:detailNegative"), String(input.negativePrompt)] as [
            string,
            string,
          ],
        ]
      : []),
    [t("media:detailSeed"), String(input.seed ?? "–")],
    [
      t("media:detailSettings"),
      Object.entries((input.parameters as Record<string, unknown>) ?? {})
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ") || "–",
    ],
    [t("media:detailMade"), formatDateTime(job.finishedAt ?? job.createdAt)],
    ...(asset
      ? [
          [
            t("media:detailFile"),
            `${asset.relativePath} · ${t("media:managedCopy")}`,
          ] as [string, string],
        ]
      : []),
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs leading-4">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-dim">{label}</dt>
          <dd data-selectable className="break-words text-fg-muted">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ResultCard({
  job,
  scene,
  slot,
}: {
  job: Job;
  scene: Scene;
  slot: Slot;
}) {
  const asset = useStudio((state) =>
    job.outputAssetId ? (state.assets[job.outputAssetId] ?? null) : null,
  );
  const applyJobOutput = useStudio((state) => state.applyJobOutput);
  const retryJob = useStudio((state) => state.retryJob);
  const [open, setOpen] = useState(false);
  const inScene =
    job.outputAssetId !== null &&
    scene[slot === "image" ? "imageAssetId" : "videoAssetId"] ===
      job.outputAssetId;
  const failed = job.status !== "completed";
  return (
    <li
      className={cx(
        "flex flex-col gap-1.5 rounded-md border p-2",
        inScene ? "border-accent/50 bg-accent/5" : "border-line bg-canvas",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={!asset}
          title={t("media:preview")}
          onClick={() => asset && openMediaPreview(asset)}
          className="shrink-0 overflow-hidden rounded border border-line-strong hover:border-accent/60 disabled:cursor-default"
        >
          <AssetThumb asset={asset} className="h-[54px] w-24" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5 text-2xs">
            <span className="font-medium text-fg">
              {t("media:attempt", { n: job.attempt })}
            </span>
            <span className="text-fg-dim">{modeLabel(job.input.mode)}</span>
            {job.metadata.isTest === true && (
              <Badge tone="warn">{t("media:statusTest")}</Badge>
            )}
            {failed && (
              <Badge tone="danger">
                {job.status === "cancelled"
                  ? t("media:stopped")
                  : job.status === "interrupted"
                    ? t("media:interrupted")
                    : t("media:failed")}
              </Badge>
            )}
          </div>
          {failed ? (
            <p className="text-2xs leading-4 text-danger">
              {job.error?.message}
            </p>
          ) : (
            <VerificationLine job={job} />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {!failed &&
          (inScene ? (
            <Badge tone="accent">{t("media:inScene")}</Badge>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void applyJobOutput(job.id)}
            >
              {t("media:useInScene")}
            </Button>
          ))}
        {failed && (
          <Button
            size="sm"
            icon={RotateCcw}
            onClick={() => void retryJob(job.id)}
          >
            {t("media:runAgain")}
          </Button>
        )}
        <button
          type="button"
          aria-expanded={open}
          className="text-2xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("media:hideDetails") : t("media:details")}
        </button>
      </div>
      {open && <ResultDetails job={job} asset={asset} />}
    </li>
  );
}

/** A short clip is held on its last frame by the renderer, never stretched. */
function DurationMismatch({ scene }: { scene: Scene }) {
  const clip = useStudio((state) =>
    scene.videoAssetId ? (state.assets[scene.videoAssetId] ?? null) : null,
  );
  const editScene = useStudio((state) => state.editScene);
  const seconds = clip?.durationSeconds ?? null;
  if (seconds === null || seconds >= scene.durationSeconds - 0.25) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-warn/30 bg-warn/10 p-2 text-2xs leading-4 text-fg">
      <p>
        {t("media:durationMismatch", {
          clip: seconds.toFixed(1),
          scene: scene.durationSeconds.toFixed(1),
          gap: (scene.durationSeconds - seconds).toFixed(1),
        })}
      </p>
      <Button
        size="sm"
        icon={Ruler}
        className="self-start"
        onClick={() =>
          editScene(scene.id, {
            durationSeconds: Math.round(seconds * 10) / 10,
          })
        }
      >
        {t("media:fitSceneToClip", { clip: seconds.toFixed(1) })}
      </Button>
    </div>
  );
}

interface Candidate {
  asset: Asset;
  label: string;
}

/** Pictures that can start a run: the scene's, its references', the episode's. */
function useStartingImages(scene: Scene, referenceIds: string[]): Candidate[] {
  const scenes = useStudio((state) => state.scenes);
  const assets = useStudio((state) => state.assets);
  const jobs = useStudio((state) => state.jobs);
  const references = useReferences((state) => state.references);
  return useMemo(() => {
    const seen = new Set<string>();
    const list: Candidate[] = [];
    const add = (id: string | null, label: string) => {
      const asset = id ? assets[id] : undefined;
      if (!asset || asset.kind !== "image" || seen.has(asset.id)) return;
      seen.add(asset.id);
      list.push({ asset, label });
    };
    add(scene.imageAssetId, t("media:sceneImage"));
    for (const reference of references) {
      if (!referenceIds.includes(reference.id)) continue;
      for (const id of reference.assetIds) {
        add(id, t("media:referenceImage", { name: reference.name }));
      }
    }
    scenes.forEach((other, index) =>
      add(other.imageAssetId, t("media:otherScene", { index: index + 1 })),
    );
    for (const job of jobs) {
      if (
        job.episodeId === scene.episodeId &&
        job.type === "image_generation"
      ) {
        add(job.outputAssetId, t("media:earlierResult"));
      }
    }
    return list;
  }, [scene, scenes, assets, jobs, references, referenceIds]);
}

function GenerationForm({
  scene,
  plan,
  task,
  engine,
  capability,
}: {
  scene: Scene;
  plan: BlueprintScene["plan"];
  task: Task;
  engine: EngineStatus;
  capability: EngineCapability;
}) {
  const createGenerationJob = useStudio((state) => state.createGenerationJob);
  const updatePlan = useBlueprint((state) => state.updatePlan);
  const references = useReferences((state) => state.references);
  const busy = useStudio((state) =>
    state.jobs.some(
      (job) =>
        job.type === task && job.sceneId === scene.id && isActiveJob(job),
    ),
  );
  const scenePrompt =
    task === "video_generation"
      ? scene.motionPrompt.trim() || scene.imagePrompt.trim()
      : scene.imagePrompt.trim();
  const [prompt, setPrompt] = useState(scenePrompt);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState(
    plan.engineId === engine.id && plan.model
      ? plan.model
      : (capability.models[0]?.id ?? ""),
  );
  const [, setChoice] = useState<ModelChoice | null>(null);
  const [resolution, setResolution] = useState(0);
  const [seed, setSeed] = useState("");
  const maxClip = capability.maxClipSeconds;
  const [clipSeconds, setClipSeconds] = useState(() =>
    Math.min(scene.durationSeconds, maxClip ?? scene.durationSeconds),
  );
  const [values, setValues] = useState<Record<string, ParameterValue>>(() =>
    Object.fromEntries(
      capability.parameters.map((spec) => [spec.key, spec.defaultValue]),
    ),
  );
  const linked = plan.visualReferenceIds;
  const candidates = useStartingImages(scene, linked);
  const [startId, setStartId] = useState<string | null>(() =>
    capability.acceptsInputImage && task === "video_generation"
      ? scene.imageAssetId
      : null,
  );
  const [starting, setStarting] = useState(false);
  useEffect(() => setPrompt(scenePrompt), [scenePrompt]);

  const linkedReferences = references.filter((item) =>
    linked.includes(item.id),
  );
  const sent = composeGenerationPrompt(prompt, linkedReferences);
  const size = capability.resolutions[resolution] ??
    capability.resolutions[0] ?? { width: 1920, height: 1080 };
  const seedValue = seed.trim() === "" ? null : Number(seed);
  const seedValid =
    seedValue === null ||
    (Number.isInteger(seedValue) &&
      seedValue >= 0 &&
      seedValue <= 4_294_967_295);
  const clipValid =
    task !== "video_generation" ||
    (clipSeconds > 0 && (maxClip === null || clipSeconds <= maxClip));

  const blocker = !capability.available
    ? (capability.reason ?? t("media:statusUnavailable"))
    : busy
      ? t("media:blockBusy")
      : capability.requiresInputImage && !startId
        ? t("media:blockStartingImage")
        : capability.requiresPrompt && !prompt.trim()
          ? t("media:blockPrompt")
          : capability.requiresModel && !model.trim()
            ? t("media:blockModel")
            : !seedValid
              ? t("media:blockSeed")
              : !clipValid
                ? t("media:blockClip", { max: maxClip ?? 0 })
                : null;

  const start = async () => {
    setStarting(true);
    await createGenerationJob({
      sceneId: scene.id,
      task,
      engine,
      model: model.trim() || null,
      width: size.width,
      height: size.height,
      parameters: values,
      prompt,
      negativePrompt: capability.supportsNegativePrompt ? negativePrompt : "",
      seed: capability.supportsSeed ? seedValue : null,
      inputImageAssetId: capability.acceptsInputImage ? startId : null,
      ...(task === "video_generation" ? { clipSeconds } : {}),
      visualReferenceIds: linked,
    });
    setStarting(false);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <CapabilitySummary capability={capability} />

      {(capability.requiresModel || capability.models.length > 1) && (
        <Field label={t("media:model")}>
          {(id) => (
            <ModelPicker
              id={id}
              task={task}
              adapterId={engine.id}
              engineName={engine.name}
              capability={capability}
              value={model}
              onChange={(value) => {
                setModel(value);
                void updatePlan(scene.id, {
                  engineId: engine.id,
                  model: value || null,
                });
              }}
              onSelectedChoice={setChoice}
            />
          )}
        </Field>
      )}

      <Field
        label={t("media:prompt")}
        hint={t("media:promptHint")}
        aside={
          prompt !== scenePrompt ? (
            <button
              type="button"
              className="text-2xs text-fg-dim hover:text-accent"
              onClick={() => setPrompt(scenePrompt)}
            >
              {t("media:resetPrompt")}
            </button>
          ) : undefined
        }
      >
        {(id) => (
          <textarea
            id={id}
            rows={3}
            className="control resize-y text-xs"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        )}
      </Field>
      {capability.supportsNegativePrompt && (
        <Field label={t("media:negativePrompt")} hint={t("media:negativeHint")}>
          {(id) => (
            <input
              id={id}
              className="control text-xs"
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
            />
          )}
        </Field>
      )}

      <ReferenceManager
        projectReferences={references}
        linked={linked}
        onLink={(ids) => void updatePlan(scene.id, { visualReferenceIds: ids })}
        pictures={candidates.map((candidate) => candidate.asset)}
      />
      {linkedReferences.length > 0 && (
        <p className="rounded-md border border-line bg-canvas p-2 text-2xs leading-4 text-fg-muted">
          <span className="text-fg-dim">{t("media:sentPrompt")} </span>
          <span data-selectable>{sent}</span>
        </p>
      )}

      {capability.acceptsInputImage && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-2xs font-medium text-fg-muted">
            {t("media:startingImage")}
          </legend>
          <p className="text-2xs leading-4 text-fg-dim">
            {capability.requiresInputImage
              ? t("media:startingRequired")
              : t("media:startingOptional")}
          </p>
          {candidates.length === 0 ? (
            <p className="text-2xs text-fg-dim">{t("media:noCandidates")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {!capability.requiresInputImage && (
                <button
                  type="button"
                  aria-pressed={startId === null}
                  onClick={() => setStartId(null)}
                  className={cx(
                    "flex h-[54px] w-24 items-center justify-center rounded border text-2xs",
                    startId === null
                      ? "border-accent text-accent"
                      : "border-line text-fg-dim hover:border-line-strong",
                  )}
                >
                  {t("media:noStartingImage")}
                </button>
              )}
              {candidates.map(({ asset, label }) => (
                <button
                  key={asset.id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={startId === asset.id}
                  onClick={() => setStartId(asset.id)}
                  className={cx(
                    "overflow-hidden rounded border-2",
                    startId === asset.id
                      ? "border-accent"
                      : "border-transparent hover:border-line-strong",
                  )}
                >
                  <AssetThumb asset={asset} className="h-[50px] w-[88px]" />
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-2">
        {capability.resolutions.length > 0 && (
          <Field label={t("media:outputSize")}>
            {(id) => (
              <select
                id={id}
                className="control tabular-nums"
                value={resolution}
                onChange={(event) => setResolution(Number(event.target.value))}
              >
                {capability.resolutions.map((entry, index) => (
                  <option key={`${entry.width}x${entry.height}`} value={index}>
                    {entry.width} × {entry.height}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {capability.supportsSeed && (
          <Field label={t("media:seed")} hint={t("media:seedHint")}>
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                className="control tabular-nums"
                placeholder={t("media:randomSeed")}
                value={seed}
                onChange={(event) =>
                  setSeed(event.target.value.replace(/\D/g, ""))
                }
              />
            )}
          </Field>
        )}
        {task === "video_generation" && (
          <Field
            label={t("media:clipLength")}
            hint={
              maxClip === null
                ? t("media:clipHintUnknown")
                : t("media:clipHint", {
                    max: maxClip,
                    scene: scene.durationSeconds.toFixed(1),
                  })
            }
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min={0.5}
                max={maxClip ?? undefined}
                step={0.5}
                className="control tabular-nums"
                value={clipSeconds}
                onChange={(event) => setClipSeconds(Number(event.target.value))}
              />
            )}
          </Field>
        )}
      </div>

      {capability.parameters.map((spec) => (
        <ParameterField
          key={spec.key}
          spec={spec}
          value={values[spec.key] ?? spec.defaultValue}
          onChange={(value) =>
            setValues((current) => ({ ...current, [spec.key]: value }))
          }
        />
      ))}

      {blocker && (
        <p className="rounded-md border border-line bg-canvas p-2 text-2xs leading-4 text-fg-muted">
          {blocker}
        </p>
      )}
      <Button
        variant="primary"
        icon={Sparkles}
        busy={starting}
        disabled={blocker !== null}
        className="self-start"
        onClick={() => void start()}
      >
        {task === "video_generation"
          ? t("media:generateClip")
          : t("media:generateImage")}
        {capability.maturity === "test" && t("media:testSuffix")}
      </Button>
    </div>
  );
}

/** Framebop's own image engine, installed by the engine on request. */
export const NATIVE_IMAGE_ENGINE = "stable-diffusion-cpp";

export function RuntimeInstall() {
  const refreshEngines = useStudio((state) => state.refreshEngines);
  const notify = useStudio((state) => state.notify);
  const [status, setStatus] = useState<ImageRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void bridge
      .call("runtimes.imageStatus", {})
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  if (!status || status.state === "installed") return null;
  const size = status.downloadBytes ? formatBytes(status.downloadBytes) : "";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-2.5 text-2xs leading-4 text-fg-muted">
      <p className="text-fg">
        {status.state === "unsupported"
          ? t("media:runtimeUnsupported")
          : t("media:runtimeMissing", { name: status.name })}
      </p>
      {status.state !== "unsupported" && (
        <>
          <p>
            {t("media:runtimeDetails", {
              version: status.version,
              license: status.license,
              size,
            })}
          </p>
          <Button
            size="sm"
            variant="primary"
            busy={busy || status.state === "installing"}
            className="self-start"
            onClick={async () => {
              const agreed = await confirm({
                title: t("media:runtimeInstallTitle"),
                message: t("media:runtimeInstallMessage", { size }),
                confirmLabel: t("media:runtimeInstall", { size }),
              });
              if (!agreed) return;
              setBusy(true);
              try {
                setStatus(
                  await bridge.call("runtimes.installImage", {
                    approved: true,
                  }),
                );
                await refreshEngines();
              } catch (error) {
                notify(
                  "error",
                  errorMessage(error, t("media:runtimeInstallFailed")),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("media:runtimeInstall", { size })}
          </Button>
        </>
      )}
    </div>
  );
}

function Generation({
  blueprintScene,
  scene,
  task,
}: {
  blueprintScene: BlueprintScene;
  scene: Scene;
  task: Task;
}) {
  const engines = useStudio((state) => state.engines);
  const updatePlan = useBlueprint((state) => state.updatePlan);
  const slot: Slot = task === "image_generation" ? "image" : "video";
  const jobs = useStudio((state) => state.jobs);
  const options = useMemo(
    () =>
      engines.flatMap((engine) =>
        engine.capabilities
          .filter((capability) => capability.task === task)
          .map((capability) => ({ engine, capability })),
      ),
    [engines, task],
  );
  const plan = blueprintScene.plan;
  const selected =
    options.find((option) => option.engine.id === plan.engineId) ??
    options.find(
      (option) =>
        option.capability.available && option.capability.maturity !== "test",
    ) ??
    options.find((option) => option.capability.available) ??
    options[0] ??
    null;
  const sceneJobs = jobs.filter(
    (job) => job.sceneId === scene.id && job.type === task,
  );
  const active = sceneJobs.find(isActiveJob) ?? null;
  const results = sceneJobs.filter((job) => !isActiveJob(job));

  return (
    <div className="flex flex-col gap-2.5">
      {selected === null ? (
        <p className="text-2xs leading-4 text-fg-muted">
          {t("media:noEngine")}
        </p>
      ) : (
        <>
          <Field label={t("media:engine")}>
            {(id) => (
              <div className="flex items-center gap-2">
                <select
                  id={id}
                  className="control flex-1"
                  value={selected.engine.id}
                  onChange={(event) =>
                    void updatePlan(scene.id, {
                      engineId: event.target.value,
                      model: null,
                    })
                  }
                >
                  {options.map(({ engine, capability }) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.name}
                      {capability.maturity === "test"
                        ? t("media:testSuffix")
                        : ""}
                      {capability.available
                        ? ""
                        : ` · ${t("media:statusUnavailable")}`}
                    </option>
                  ))}
                </select>
                <EngineState capability={selected.capability} />
              </div>
            )}
          </Field>
          {selected.engine.id === NATIVE_IMAGE_ENGINE &&
            !selected.capability.available && <RuntimeInstall />}
          <GenerationForm
            key={`${task}:${selected.engine.id}`}
            scene={scene}
            plan={plan}
            task={task}
            engine={selected.engine}
            capability={selected.capability}
          />
        </>
      )}

      {active && <ActiveRun job={active} />}
      {task === "video_generation" && <DurationMismatch scene={scene} />}

      <section className="flex flex-col gap-1.5">
        <h4 className="text-2xs font-medium text-fg-muted">
          {t("media:results")}
        </h4>
        {results.length === 0 ? (
          <p className="text-2xs text-fg-dim">{t("media:noResults")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {results.map((job) => (
              <ResultCard key={job.id} job={job} scene={scene} slot={slot} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Pictures and clips the user provides: nothing is generated. */
function ExistingMedia({ scene, slot }: { scene: Scene; slot: Slot }) {
  const importMedia = useStudio((state) => state.importMedia);
  const asset = useStudio((state) => {
    const id = slot === "image" ? scene.imageAssetId : scene.videoAssetId;
    return id ? (state.assets[id] ?? null) : null;
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs leading-4 text-fg-muted">
        {slot === "image"
          ? t("media:existingImageNote")
          : t("media:existingVideoNote")}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!asset}
          onClick={() => asset && openMediaPreview(asset)}
          className="overflow-hidden rounded border border-line-strong disabled:cursor-default"
          aria-label={t("media:preview")}
        >
          <AssetThumb asset={asset} className="h-[54px] w-24" />
        </button>
        <div className="flex flex-col gap-1">
          <span className="text-2xs text-fg-dim">
            {asset ? t("media:inScene") : t("media:nothingYet")}
          </span>
          <Button
            size="sm"
            icon={slot === "image" ? ImagePlus : Film}
            onClick={() => void importMedia(scene.id, slot)}
          >
            {slot === "image"
              ? t("media:importPicture")
              : t("media:importClip")}
          </Button>
        </div>
      </div>
      {slot === "video" && <DurationMismatch scene={scene} />}
    </div>
  );
}

export function MediaProduction({
  blueprintScene,
}: {
  blueprintScene: BlueprintScene;
}) {
  const scene = useStudio((state) =>
    state.scenes.find((candidate) => candidate.id === blueprintScene.sceneId),
  );
  const projectId = useStudio((state) => state.activeProjectId);
  const loadReferences = useReferences((state) => state.load);
  useEffect(() => {
    if (projectId) void loadReferences(projectId);
  }, [projectId, loadReferences]);

  const method = blueprintScene.plan.method;
  return (
    <section
      aria-label={t("media:panelTitle")}
      className="flex flex-col gap-2.5 rounded-lg border border-line bg-canvas/60 p-3"
    >
      <h3 className="text-xs font-medium text-fg">{t("media:panelTitle")}</h3>
      {!scene ? (
        <p className="text-2xs text-fg-dim">{t("media:openEpisode")}</p>
      ) : method === "layered-2d" ? (
        <p className="text-2xs leading-4 text-fg-muted">
          {t("media:layeredNote")}
        </p>
      ) : method === "static-image" ? (
        <ExistingMedia scene={scene} slot="image" />
      ) : method === "video-clip" ? (
        <ExistingMedia scene={scene} slot="video" />
      ) : (
        <Generation
          blueprintScene={blueprintScene}
          scene={scene}
          task={
            method === "image-to-video"
              ? "video_generation"
              : "image_generation"
          }
        />
      )}
    </section>
  );
}
