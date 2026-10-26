import {
  LTX_VIDEO_ENGINE,
  type ModelChoice,
  type Scene,
  isActiveJob,
} from "@framebop/core";
import {
  Clapperboard,
  Clock3,
  FolderOpen,
  ImagePlus,
  Maximize2,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModelPicker } from "../../components/ModelPicker";
import { AssetThumb } from "../../components/media";
import { Badge, Button, Field, Modal, cx } from "../../components/ui";
import { t } from "../../i18n";
import { bridge } from "../../lib/bridge";
import { useBlueprint } from "../../store/blueprint";
import { useReferences } from "../../store/references";
import { useStudio } from "../../store/studio";
import {
  ActiveRun,
  DurationMismatch,
  ResultCard,
} from "../blueprint/MediaProduction";
import { ReferenceManager } from "../blueprint/ReferenceManager";

/** The tested LTX preset, surfaced without hiding its actual model inputs. */
export function VideoStudio({ scene }: { scene: Scene }) {
  const engines = useStudio((s) => s.engines);
  const settings = useStudio((s) => s.settings);
  const choose = useStudio((s) => s.chooseProgram);
  const refreshEngines = useStudio((s) => s.refreshEngines);
  const refreshModels = useStudio((s) => s.refreshModels);
  const models = useStudio((s) => s.models);
  const assets = useStudio((s) => s.assets);
  const jobs = useStudio((s) => s.jobs);
  const editScene = useStudio((s) => s.editScene);
  const createJob = useStudio((s) => s.createGenerationJob);
  const importMedia = useStudio((s) => s.importMedia);
  const setTab = useStudio((s) => s.setTab);
  const projectId = useStudio((s) => s.activeProjectId);
  const references = useReferences((s) => s.references);
  const loadReferences = useReferences((s) => s.load);
  const blueprint = useBlueprint((s) => s.blueprint);
  const loadBlueprint = useBlueprint((s) => s.load);
  const updatePlan = useBlueprint((s) => s.updatePlan);
  const plan = blueprint?.scenes.find(
    (item) => item.sceneId === scene.id,
  )?.plan;
  const linked = plan?.visualReferenceIds ?? [];
  const engine = engines.find((e) => e.id === LTX_VIDEO_ENGINE);
  const capability = engine?.capabilities.find(
    (c) => c.task === "video_generation",
  );
  const [model, setModel] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [seed, setSeed] = useState("");
  const [startId, setStartId] = useState<string | null>(null);
  const [strength, setStrength] = useState(1);
  const [deadline, setDeadline] = useState(600);
  const [starting, setStarting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const anchorInitialized = useRef(false);
  const modelState = models
    .map((m) => `${m.entry.id}:${m.installation?.state}`)
    .join("|");

  useEffect(() => {
    if (projectId) void loadReferences(projectId);
    void loadBlueprint(scene.episodeId);
    void refreshModels();
  }, [
    projectId,
    scene.episodeId,
    loadReferences,
    loadBlueprint,
    refreshModels,
  ]);
  useEffect(() => {
    if (!capability?.available) return;
    let current = true;
    void bridge
      .call("models.choices", {
        task: "video_generation",
        adapterId: LTX_VIDEO_ENGINE,
      })
      .then((choices) => {
        if (!current) return;
        setModel((old) =>
          choices.some((c) => c.usable && c.reference === old)
            ? old
            : (choices.find((c) => c.usable && c.kind !== "download")
                ?.reference ?? ""),
        );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [capability?.available, modelState, settings.ltxVideoModelDirectory]);

  const pictures = Object.values(assets).filter(
    (a) => a.projectId === projectId && a.kind === "image",
  );
  const referencePictures = new Set(
    references.filter((r) => linked.includes(r.id)).flatMap((r) => r.assetIds),
  );
  const candidates = [...pictures].sort(
    (a, b) =>
      Number(referencePictures.has(b.id)) - Number(referencePictures.has(a.id)),
  );
  useEffect(() => {
    if (anchorInitialized.current || !plan) return;
    if (plan.method === "image-to-video" && !candidates.length) return;
    anchorInitialized.current = true;
    if (plan.method === "image-to-video") {
      setStartId(candidates[0]?.id ?? null);
    }
  }, [plan, candidates]);
  const selectedImage = startId ? assets[startId] : null;
  const active = jobs.find(
    (j) =>
      j.sceneId === scene.id && j.type === "video_generation" && isActiveJob(j),
  );
  const results = jobs.filter(
    (j) =>
      j.sceneId === scene.id &&
      j.type === "video_generation" &&
      !isActiveJob(j),
  );
  const clip = scene.videoAssetId ? assets[scene.videoAssetId] : null;
  const sizes = capability?.resolutions ?? [];
  const size = sizes[sizeIndex] ?? sizes[0];
  const prompt = scene.motionPrompt;
  const seedNumber = seed === "" ? null : Number(seed);
  const seedValid =
    seedNumber === null ||
    (Number.isInteger(seedNumber) &&
      seedNumber >= 0 &&
      seedNumber <= 4294967295);
  const valid = Boolean(
    engine &&
    capability?.available &&
    model &&
    size &&
    prompt.trim() &&
    seedValid &&
    !active &&
    (!startId || selectedImage?.kind === "image") &&
    seconds >= 1 &&
    seconds <= 5,
  );
  const setupFields = [
    ["ltxVideoPython", t("video:python"), settings.ltxVideoPython],
    [
      "ltxVideoModelDirectory",
      t("video:modelFolder"),
      settings.ltxVideoModelDirectory,
    ],
    [
      "ltxVideoTextEncoderDirectory",
      t("video:encoderFolder"),
      settings.ltxVideoTextEncoderDirectory,
    ],
  ] as const;

  const content = (
    <section
      aria-label={t("video:title")}
      className="overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-b from-accent/10 to-canvas/80"
    >
      <header className="flex items-center justify-between gap-2 border-b border-accent/15 px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent/15 text-accent">
            <Clapperboard className="size-5" aria-hidden />
          </span>
          <div>
            <h4 className="text-ui font-semibold text-fg">
              {t("video:title")}
            </h4>
            <p className="text-2xs text-fg-muted">
              LTX-2.3 Q4 · {t("video:local")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={capability?.available && model ? "ok" : "warn"}>
            {t(capability?.available && model ? "video:ready" : "video:setup")}
          </Badge>
          {!expanded && (
            <Button
              size="sm"
              icon={Maximize2}
              aria-label={t("video:expand")}
              title={t("video:expand")}
              onClick={() => setExpanded(true)}
            />
          )}
        </div>
      </header>
      <div className="flex flex-col gap-3 p-3">
        {clip ? (
          <video
            key={clip.id}
            controls
            preload="metadata"
            src={bridge.mediaUrl(clip, "file")}
            className="aspect-video w-full rounded-lg bg-black object-contain"
          />
        ) : (
          <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-line-strong bg-canvas/60 text-center">
            <div className="flex flex-col items-center gap-2 px-5">
              <Clapperboard className="size-7 text-accent/60" aria-hidden />
              <p className="text-xs text-fg-muted">{t("video:previewEmpty")}</p>
              <span className="text-2xs text-fg-dim">
                {t("video:previewHint")}
              </span>
            </div>
          </div>
        )}

        {(!capability?.available || !model || settingsOpen) && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas/70 p-2.5">
            <p className="text-2xs leading-4 text-fg-muted">
              {capability?.reason ?? t("video:setupHint")}
            </p>
            {setupFields.map(([key, label, path]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-2xs text-fg">{label}</p>
                  <p
                    className="truncate text-2xs text-fg-dim"
                    title={path ?? undefined}
                  >
                    {path?.split(/[\\/]/).pop() ??
                      t(
                        key === "ltxVideoPython"
                          ? "video:pythonNotChosen"
                          : "video:notChosen",
                      )}
                  </p>
                </div>
                <Button
                  size="sm"
                  icon={FolderOpen}
                  onClick={() => void choose(key)}
                >
                  {t("video:choose")}
                </Button>
              </div>
            ))}
            <p className="text-2xs leading-4 text-fg-dim">
              {t("video:setupHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setTab("models")}>
                {t("video:manageModels")}
              </Button>
              <Button size="sm" onClick={() => void refreshEngines()}>
                {t("video:refresh")}
              </Button>
            </div>
          </div>
        )}

        <Field label={t("video:prompt")} hint={t("video:promptHint")}>
          {(id) => (
            <textarea
              id={id}
              rows={5}
              maxLength={4000}
              className="control resize-y text-xs leading-5"
              value={prompt}
              placeholder={t("video:promptPlaceholder")}
              onChange={(e) =>
                editScene(scene.id, { motionPrompt: e.target.value })
              }
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("video:duration")} hint={t("video:durationHint")}>
            {(id) => (
              <div className="flex items-center gap-2">
                <Clock3 className="size-4 shrink-0 text-fg-dim" aria-hidden />
                <input
                  id={id}
                  className="control tabular-nums"
                  type="number"
                  min={1}
                  max={5}
                  step={0.5}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                />
                <span className="text-xs text-fg-muted">s</span>
              </div>
            )}
          </Field>
          <Field label={t("video:resolution")} hint="24 fps · H.264">
            {(id) => (
              <select
                id={id}
                className="control tabular-nums"
                value={sizeIndex}
                onChange={(e) => setSizeIndex(Number(e.target.value))}
              >
                {sizes.map((s, index) => (
                  <option key={index} value={index}>
                    {s.width} × {s.height}
                    {s.width === 1024 ? " · 1K" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium text-fg">
            {t("video:referenceTitle")}
          </legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1">
            <button
              type="button"
              aria-pressed={!startId}
              className={cx(
                "rounded-md px-2 py-2 text-2xs",
                !startId
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-fg-muted",
              )}
              onClick={() => setStartId(null)}
            >
              {t("video:fromText")}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(startId)}
              className={cx(
                "rounded-md px-2 py-2 text-2xs",
                startId
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-fg-muted",
              )}
              disabled={!candidates.length}
              onClick={() => setStartId(candidates[0]?.id ?? null)}
            >
              {t("video:fromImage")}
            </button>
          </div>
          <p className="text-2xs leading-4 text-fg-dim">
            {t("video:referenceHint")}
          </p>
          {candidates.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {candidates.map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  aria-label={asset.originalFilename}
                  title={asset.originalFilename}
                  aria-pressed={startId === asset.id}
                  onClick={() => setStartId(asset.id)}
                  className={cx(
                    "relative shrink-0 overflow-hidden rounded-lg border-2",
                    startId === asset.id
                      ? "border-accent"
                      : "border-transparent hover:border-line-strong",
                  )}
                >
                  <AssetThumb asset={asset} className="h-16 w-24" />
                  {referencePictures.has(asset.id) && (
                    <ImagePlus
                      className="absolute right-1 bottom-1 size-4 rounded bg-canvas/80 text-accent"
                      aria-hidden
                    />
                  )}
                </button>
              ))}
            </div>
          )}
          {selectedImage && (
            <p className="text-2xs text-accent">
              {t("video:anchored", { name: selectedImage.originalFilename })}
            </p>
          )}
          <ReferenceManager
            projectReferences={references}
            linked={linked}
            pictures={pictures}
            onLink={(ids) => {
              void updatePlan(scene.id, { visualReferenceIds: ids });
              const added = references.find(
                (r) => ids.includes(r.id) && !linked.includes(r.id),
              );
              if (added?.assetIds[0] && !startId) setStartId(added.assetIds[0]);
              if (
                added?.seed !== null &&
                added?.seed !== undefined &&
                seed === ""
              )
                setSeed(String(added.seed));
            }}
          />
        </fieldset>

        <details className="rounded-lg border border-line bg-canvas/50 p-2.5">
          <summary className="flex cursor-pointer items-center gap-2 text-2xs font-medium text-fg-muted">
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {t("video:advanced")}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {capability && (
              <Field label={t("media:model")}>
                {(id) => (
                  <ModelPicker
                    id={id}
                    task="video_generation"
                    adapterId={LTX_VIDEO_ENGINE}
                    engineName="LTX-2.3 MLX Q4"
                    capability={capability}
                    value={model}
                    onChange={setModel}
                    onSelectedChoice={(_choice: ModelChoice | null) => {}}
                  />
                )}
              </Field>
            )}
            <Field label={t("media:seed")} hint={t("media:seedHint")}>
              {(id) => (
                <input
                  id={id}
                  className="control tabular-nums"
                  type="number"
                  min={0}
                  max={4294967295}
                  placeholder={t("media:randomSeed")}
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              )}
            </Field>
            {startId && (
              <Field
                label={t("video:strength")}
                hint={t("video:referenceHint")}
              >
                {(id) => (
                  <input
                    id={id}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={strength}
                    onChange={(e) => setStrength(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                )}
              </Field>
            )}
            <Field label={t("video:deadline")} hint={t("video:deadlineHint")}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={deadline}
                  onChange={(e) => setDeadline(Number(e.target.value))}
                >
                  <option value={600}>10 min</option>
                  <option value={1200}>20 min</option>
                </select>
              )}
            </Field>
            <Button size="sm" onClick={() => setSettingsOpen((open) => !open)}>
              {t("video:runtimeSettings")}
            </Button>
          </div>
        </details>
        <p className="text-2xs leading-4 text-fg-dim">
          {t("video:performanceHint")}
        </p>
        {clip && <DurationMismatch scene={scene} />}
        {active && <ActiveRun job={active} />}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button
            variant="primary"
            icon={Sparkles}
            busy={starting}
            disabled={!valid}
            onClick={async () => {
              if (!engine || !size || !valid) return;
              setStarting(true);
              try {
                await updatePlan(scene.id, {
                  method: startId ? "image-to-video" : "text-to-video",
                  engineId: LTX_VIDEO_ENGINE,
                  model,
                  visualReferenceIds: linked,
                });
                await createJob({
                  sceneId: scene.id,
                  task: "video_generation",
                  engine,
                  model,
                  width: size.width,
                  height: size.height,
                  prompt,
                  negativePrompt: "",
                  seed: seedNumber,
                  inputImageAssetId: startId,
                  clipSeconds: seconds,
                  visualReferenceIds: linked,
                  parameters: {
                    referenceStrength: strength,
                    timeoutSeconds: deadline,
                  },
                });
              } finally {
                setStarting(false);
              }
            }}
          >
            {t("video:generate", { seconds })}
          </Button>
          <Button
            icon={Upload}
            aria-label={t("create:addOwnClip")}
            title={t("create:addOwnClip")}
            onClick={() => void importMedia(scene.id, "video")}
          />
        </div>
        {results.length > 0 && (
          <details>
            <summary className="cursor-pointer text-2xs text-fg-muted">
              {t("video:attempts", { count: results.length })}
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {results.map((job) => (
                <ResultCard key={job.id} job={job} scene={scene} slot="video" />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
  return expanded
    ? createPortal(
        <Modal
          title={t("video:title")}
          width="lg"
          onClose={() => setExpanded(false)}
        >
          {content}
        </Modal>,
        document.body,
      )
    : content;
}
