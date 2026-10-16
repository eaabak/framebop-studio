import {
  type EngineCapability,
  type EngineStatus,
  type ParameterSpec,
  type ParameterValue,
  type ModelChoice,
  type Scene,
  type Voice,
  applyPreset,
  formatDuration,
  isActiveJob,
} from "@framebop/core";
import { Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModelPicker } from "../../components/ModelPicker";
import { CapabilitySummary } from "../../components/engines";
import {
  JobOutput,
  canStop,
  describeJobState,
  jobRunSeconds,
  useNow,
} from "../../components/jobs";
import { Button, Field, ProgressBar, Spinner, cx } from "../../components/ui";
import { bridge } from "../../lib/bridge";
import { useStudio } from "../../store/studio";
import { Section } from "./Section";
import { t } from "../../i18n";
import { parameterText } from "../../lib/jobLabels";

type Task = "image_generation" | "video_generation" | "audio_generation";

const TASKS: { id: Task; label: string; slot: "image" | "video" | "audio" }[] =
  [
    {
      id: "image_generation",
      get label() {
        return t("editor:image");
      },
      slot: "image",
    },
    {
      id: "video_generation",
      get label() {
        return t("editor:videoClip");
      },
      slot: "video",
    },
    {
      id: "audio_generation",
      get label() {
        return t("editor:narration");
      },
      slot: "audio",
    },
  ];

const SLOT_FIELD = {
  image: "imageAssetId",
  video: "videoAssetId",
  audio: "audioAssetId",
} as const;

/** The voices that come with the chosen speech model, read from its folder. */
function VoiceField({
  adapterId,
  model,
  value,
  onChange,
}: {
  adapterId: string;
  model: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setVoices(null);
    setError(null);
    if (!model) return;
    let current = true;
    bridge
      .call("audio.voices", { adapterId, model })
      .then((result) => {
        if (!current) return;
        setVoices(result);
        // Keep the choice valid when the model changes.
        if (!result.some((voice) => voice.id === value && voice.supported)) {
          const first = result.find((voice) => voice.supported);
          if (first) onChange(first.id);
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(
            reason instanceof Error
              ? reason.message
              : t("editor:voicesCouldNotBeListed"),
          );
        }
      });
    return () => {
      current = false;
    };
    // `value` and `onChange` are read, not watched: only a new model reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterId, model]);

  return (
    <Field
      label={t("editor:voice")}
      hint={
        error ??
        (!model
          ? t("editor:chooseAModelFirstTheVoices")
          : voices?.length === 0
            ? t("editor:noVoiceFilesWereFoundNext")
            : t("editor:voiceFilesFoundNextToThe"))
      }
    >
      {(id) => (
        <select
          id={id}
          className="control"
          value={value}
          disabled={!voices || voices.length === 0}
          onChange={(event) => onChange(event.target.value)}
        >
          {(voices ?? []).map((voice) => (
            <option
              key={voice.id}
              value={voice.id}
              disabled={!voice.supported}
              title={voice.reason ?? undefined}
            >
              {voice.name} · {voice.languageName}
              {voice.gender ? `, ${voice.gender}` : ""}
              {voice.supported ? "" : t("editor:notSupportedYet")}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface EngineOption {
  engine: EngineStatus;
  capability: EngineCapability;
}

export function ParameterField({
  spec,
  value,
  onChange,
}: {
  spec: ParameterSpec;
  value: ParameterValue;
  onChange: (value: ParameterValue) => void;
}) {
  const text = parameterText(spec);
  return (
    <Field label={text.label} hint={text.hint}>
      {(id) =>
        spec.type === "enum" ? (
          <select
            id={id}
            className="control"
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
          >
            {spec.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : spec.type === "boolean" ? (
          <input
            id={id}
            type="checkbox"
            className="size-4 self-start accent-accent"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
        ) : spec.type === "string" ? (
          <input
            id={id}
            className="control"
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            id={id}
            className="control tabular-nums"
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? (spec.type === "integer" ? 1 : "any")}
            value={String(value)}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              // An emptied box falls back to the engine's own default.
              onChange(
                event.target.value === "" || !Number.isFinite(parsed)
                  ? spec.defaultValue
                  : parsed,
              );
            }}
          />
        )
      }
    </Field>
  );
}

/** The job for this scene and task that is waiting or running, if any. */
function ActiveJob({ scene, task }: { scene: Scene; task: Task }) {
  const job = useStudio((state) =>
    state.jobs.find(
      (candidate) =>
        candidate.type === task &&
        candidate.sceneId === scene.id &&
        isActiveJob(candidate),
    ),
  );
  const queuePaused = useStudio((state) => state.queue.paused);
  const cancelJob = useStudio((state) => state.cancelJob);
  const setTab = useStudio((state) => state.setTab);
  const now = useNow(job?.status === "running");
  if (!job) return null;

  const runSeconds = jobRunSeconds(job, now);
  const stoppable = canStop(job);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-2.5">
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span className="truncate font-medium text-fg">{job.label}</span>
        <span className="shrink-0 text-fg-muted tabular-nums">
          {describeJobState(job)}
          {runSeconds !== null && ` · ${formatDuration(runSeconds)}`}
        </span>
      </div>
      <ProgressBar value={job.status === "pending" ? 0 : job.progress} />
      {job.status === "running" &&
        job.progress !== null &&
        job.progressMessage && (
          <p className="text-2xs text-fg-dim">{job.progressMessage}</p>
        )}
      {job.status === "running" && job.metadata.reportsProgress === false && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("editor:thisEngineReportsNoProgressThe")}
        </p>
      )}
      {job.status === "pending" && queuePaused && (
        <p className="text-2xs leading-4 text-warn">
          {t("editor:theProductionQueueIsOnHold")}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setTab("production")}
          >
            {t("editor:openProduction")}
          </button>{" "}
          {t("editor:toResumeIt")}
        </p>
      )}
      <Button
        size="sm"
        icon={X}
        className="self-start"
        disabled={!stoppable || job.cancelRequestedAt !== null}
        title={
          stoppable ? undefined : t("editor:thisEngineCannotBeStoppedOnce")
        }
        onClick={() => void cancelJob(job.id)}
      >
        {job.status === "pending"
          ? t("editor:removeFromQueue")
          : t("editor:stop")}
      </Button>
    </div>
  );
}

/** The newest finished result for this slot that the scene is not showing. */
function PendingResult({ scene, task }: { scene: Scene; task: Task }) {
  const slot = TASKS.find((entry) => entry.id === task)?.slot ?? "image";
  const job = useStudio((state) =>
    state.jobs.find(
      (candidate) =>
        candidate.type === task &&
        candidate.sceneId === scene.id &&
        candidate.status === "completed" &&
        candidate.outputAssetId !== null,
    ),
  );
  if (!job || job.outputAssetId === scene[SLOT_FIELD[slot]]) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-canvas p-2">
      <span className="text-2xs leading-4 text-fg-muted">
        {t("editor:theLatestResultIsNotIn")}
      </span>
      <JobOutput job={job} />
    </div>
  );
}

function EngineForm({
  scene,
  task,
  option,
}: {
  scene: Scene;
  task: Task;
  option: EngineOption;
}) {
  const { engine, capability } = option;
  const createGenerationJob = useStudio((state) => state.createGenerationJob);
  const busy = useStudio((state) =>
    state.jobs.some(
      (job) =>
        job.type === task && job.sceneId === scene.id && isActiveJob(job),
    ),
  );
  const intent = useStudio((state) => state.generationIntent);
  const clearGenerationIntent = useStudio(
    (state) => state.clearGenerationIntent,
  );
  // A model chosen in the gallery with "Use in a scene" starts selected.
  const [model, setModel] = useState(() =>
    intent && intent.adapterId === engine.id && intent.task === task
      ? intent.reference
      : (capability.models[0]?.id ?? ""),
  );
  useEffect(() => {
    if (intent && intent.adapterId === engine.id && intent.task === task) {
      clearGenerationIntent();
    }
  }, [intent, engine.id, task, clearGenerationIntent]);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [presetId, setPresetId] = useState("");
  const [presetProblems, setPresetProblems] = useState<string[]>([]);
  const presets = choice?.presets ?? [];
  const [resolution, setResolution] = useState(0);
  const [values, setValues] = useState<Record<string, ParameterValue>>(() =>
    Object.fromEntries(
      capability.parameters.map((spec) => [spec.key, spec.defaultValue]),
    ),
  );
  const [starting, setStarting] = useState(false);

  const size = capability.resolutions[resolution] ??
    capability.resolutions[0] ?? { width: 1920, height: 1080 };
  const prompt =
    task === "audio_generation"
      ? scene.narrationText.trim()
      : task === "video_generation"
        ? scene.motionPrompt.trim() || scene.imagePrompt.trim()
        : scene.imagePrompt.trim();

  // The engine checks all of this again. Saying it here spares a round trip
  // and tells the user what to do before they press the button.
  const blocker = !capability.available
    ? (capability.reason ?? t("editor:thisEngineIsNotAvailableRight"))
    : capability.requiresInputImage && !scene.imageAssetId
      ? t("editor:thisEngineAnimatesAStillImage")
      : capability.requiresPrompt && prompt.length === 0
        ? task === "audio_generation"
          ? t("editor:writeTheNarrationTextForThis")
          : task === "video_generation"
            ? t("editor:writeAMotionPromptForThis")
            : t("editor:writeAnImagePromptForThis")
        : capability.requiresModel && model.trim().length === 0
          ? t("editor:chooseTheModelThisEngineShould")
          : null;

  const start = async () => {
    setStarting(true);
    await createGenerationJob({
      sceneId: scene.id,
      task,
      engine,
      model: model.trim() || null,
      ...(task === "audio_generation"
        ? {}
        : { width: size.width, height: size.height }),
      parameters: values,
    });
    setStarting(false);
  };

  return (
    <>
      <CapabilitySummary capability={capability} />

      {(capability.requiresModel || capability.models.length > 1) && (
        <Field label={t("editor:model")}>
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
                setPresetId("");
                setPresetProblems([]);
              }}
              onSelectedChoice={setChoice}
            />
          )}
        </Field>
      )}

      {presets.length > 0 && (
        <Field
          label={t("editor:preset")}
          hint={
            presets.find((preset) => preset.id === presetId)?.note ??
            t("editor:settingsRecordedForThisModelAnd")
          }
        >
          {(id) => (
            <select
              id={id}
              className="control"
              value={presetId}
              onChange={(event) => {
                const preset = presets.find((p) => p.id === event.target.value);
                setPresetId(event.target.value);
                if (!preset) {
                  setPresetProblems([]);
                  return;
                }
                const applied = applyPreset(
                  preset,
                  values,
                  capability.parameters,
                  capability.resolutions,
                );
                setValues(applied.values);
                if (applied.size) {
                  const index = capability.resolutions.findIndex(
                    (r) =>
                      r.width === applied.size?.width &&
                      r.height === applied.size?.height,
                  );
                  if (index >= 0) setResolution(index);
                }
                setPresetProblems(applied.problems);
              }}
            >
              <option value="">{t("editor:custom")}</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                  {preset.verified ? "" : t("editor:notCheckedYet")}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {presetProblems.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-warn/30 bg-warn/10 p-2.5 text-2xs leading-4 text-fg">
          {presetProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {capability.resolutions.length > 0 && (
        <Field label={t("editor:outputSize")}>
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

      {capability.parameters.map((spec) =>
        task === "audio_generation" && spec.key === "voice" ? (
          <VoiceField
            key={spec.key}
            adapterId={engine.id}
            model={model}
            value={String(values.voice ?? spec.defaultValue)}
            onChange={(voice) =>
              setValues((current) => ({ ...current, voice }))
            }
          />
        ) : (
          <ParameterField
            key={spec.key}
            spec={spec}
            value={values[spec.key] ?? spec.defaultValue}
            onChange={(value) =>
              setValues((current) => ({ ...current, [spec.key]: value }))
            }
          />
        ),
      )}

      {blocker && (
        <p className="rounded-md border border-line bg-canvas p-2.5 text-2xs leading-4 text-fg-muted">
          {blocker}
        </p>
      )}
      <Button
        variant="primary"
        icon={Sparkles}
        busy={starting}
        disabled={blocker !== null || busy}
        onClick={() => void start()}
      >
        {task === "audio_generation"
          ? scene.audioAssetId
            ? t("editor:generateANewTake")
            : t("editor:generateNarration")
          : task === "video_generation"
            ? t("editor:generateClip")
            : t("editor:generateImage")}
        {capability.maturity === "test" && " (test)"}
      </Button>
    </>
  );
}

export function GenerateSection({ scene }: { scene: Scene }) {
  const engines = useStudio((state) => state.engines);
  const enginesState = useStudio((state) => state.enginesState);
  const editScene = useStudio((state) => state.editScene);
  const [task, setTask] = useState<Task>("image_generation");
  const [imageEngine, setImageEngine] = useState<string | null>(null);
  const [speechEngine, setSpeechEngine] = useState<string | null>(null);
  const intent = useStudio((state) => state.generationIntent);

  // "Use in a scene" from the gallery opens the right task and engine.
  useEffect(() => {
    if (!intent) return;
    setTask(intent.task);
    if (intent.task === "video_generation") {
      if (scene.animationEngine !== intent.adapterId) {
        editScene(scene.id, { animationEngine: intent.adapterId });
      }
    } else if (intent.task === "audio_generation") {
      setSpeechEngine(intent.adapterId);
    } else {
      setImageEngine(intent.adapterId);
    }
  }, [intent, scene.id, scene.animationEngine, editScene]);

  const options = useMemo<EngineOption[]>(
    () =>
      engines.flatMap((engine) =>
        engine.capabilities
          .filter((capability) => capability.task === task)
          .map((capability) => ({ engine, capability })),
      ),
    [engines, task],
  );
  // The choice of video engine is part of the scene and is stored with it.
  const chosenId =
    task === "video_generation"
      ? scene.animationEngine
      : task === "audio_generation"
        ? speechEngine
        : imageEngine;
  const selected =
    options.find((option) => option.engine.id === chosenId) ??
    options.find((option) => option.capability.available) ??
    options[0] ??
    null;

  const choose = (engineId: string) => {
    if (task === "video_generation") {
      editScene(scene.id, { animationEngine: engineId });
    } else if (task === "audio_generation") {
      setSpeechEngine(engineId);
    } else {
      setImageEngine(engineId);
    }
  };

  return (
    <Section title={t("editor:generate")}>
      <div
        role="tablist"
        aria-label={t("editor:whatToGenerate")}
        className="flex rounded-md border border-line bg-canvas p-0.5"
      >
        {TASKS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={task === id}
            onClick={() => setTask(id)}
            className={cx(
              "h-6 flex-1 rounded text-xs font-medium transition-colors",
              task === id
                ? "bg-overlay text-fg"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <ActiveJob scene={scene} task={task} />
      <PendingResult scene={scene} task={task} />

      {selected === null ? (
        enginesState === "loading" || enginesState === "idle" ? (
          <div className="flex justify-center py-2">
            <Spinner />
          </div>
        ) : (
          <p className="text-2xs leading-4 text-fg-muted">
            {task === "audio_generation"
              ? t("editor:noEngineForNarration")
              : task === "video_generation"
                ? t("editor:noEngineForClips")
                : t("editor:noEngineForImages")}
          </p>
        )
      ) : (
        <>
          <Field label={t("editor:engine")}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={selected.engine.id}
                onChange={(event) => choose(event.target.value)}
              >
                {options.map(({ engine, capability }) => (
                  <option key={engine.id} value={engine.id}>
                    {engine.name}
                    {engine.isTest ? t("editor:testNoAi") : ""}
                    {capability.available ? "" : t("editor:notAvailable")}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {/* Keyed so that settings reset when the engine or task changes. */}
          <EngineForm
            key={`${task}:${selected.engine.id}`}
            scene={scene}
            task={task}
            option={selected}
          />
        </>
      )}
    </Section>
  );
}
