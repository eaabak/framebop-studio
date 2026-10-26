/**
 * "Make this scene": the one place where a scene gets its picture, its voice
 * and its movement, each either made with AI or added from a file. What AI
 * can do on this computer is said plainly, with one button to get it ready
 * when it is not. Every engine setting stays in the Generate section below.
 */
import {
  type EngineCapability,
  type EngineStatus,
  type ImageRuntimeStatus,
  type ModelChoice,
  type ParameterValue,
  type Scene,
  type VoiceSetupStatus,
  isActiveJob,
} from "@framebop/core";
import { AudioLines, Image as ImageIcon, Sparkles, Upload } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AssetThumb } from "../../components/media";
import { Button, ProgressBar, cx } from "../../components/ui";
import { currentLanguage, formatBytes, t } from "../../i18n";
import { bridge } from "../../lib/bridge";
import { confirm } from "../../lib/dialogs";
import { errorMessage } from "../../lib/errors";
import { useStudio } from "../../store/studio";
import { ActiveRun } from "../blueprint/MediaProduction";
import { Section } from "./Section";
import { VideoStudio } from "./VideoStudio";

type Task = "image_generation" | "audio_generation" | "video_generation";

/** The engines the easy path uses, and the models it recommends. */
const IMAGE_ENGINE = "stable-diffusion-cpp";
const VOICE_ENGINE = "sherpa-onnx";

const IMAGE_MODEL = "sd-1.5-q8-gguf";

/** Two buttons share one row, on one line, in every language. */
const PAIR = "w-full min-w-0 px-2! text-xs!";

/** A real (not test) engine for the task, with a model it can use now. */
function useAi(
  task: Task,
  preferred: string | null,
  /** The model to use when the engine offers several (a voice pack). */
  reference: string | null = null,
) {
  const engines = useStudio((state) => state.engines);
  const models = useStudio((state) => state.models);
  const option = useMemo(() => {
    const all = engines.flatMap((engine) =>
      engine.isTest
        ? []
        : engine.capabilities
            .filter((capability) => capability.task === task)
            .map((capability) => ({ engine, capability })),
    );
    return (
      all.find((item) => item.engine.id === preferred) ??
      all.find((item) => item.capability.available) ??
      null
    );
  }, [engines, task, preferred]);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  // Choices change when a model finishes installing.
  const installed = models
    .map((model) => `${model.entry.id}:${model.installation?.state ?? ""}`)
    .join("|");
  const adapterId = option?.engine.id ?? null;
  const available = option?.capability.available ?? false;
  useEffect(() => {
    if (!adapterId || !available) {
      setChoice(null);
      return;
    }
    let current = true;
    bridge
      .call("models.choices", { task, adapterId })
      .then((choices) => {
        if (!current) return;
        const usable = choices.filter(
          (item) => item.kind !== "download" && item.usable && item.reference,
        );
        setChoice(
          reference === null
            ? (usable[0] ?? null)
            : (usable.find((item) => item.reference === reference) ?? null),
        );
      })
      .catch(() => current && setChoice(null));
    return () => {
      current = false;
    };
  }, [task, adapterId, available, installed, reference]);
  return { option, choice };
}

function defaults(
  capability: EngineCapability,
): Record<string, ParameterValue> {
  return Object.fromEntries(
    capability.parameters.map((spec) => [spec.key, spec.defaultValue]),
  );
}

function Row({
  icon: Icon,
  title,
  thumb,
  children,
}: {
  icon: typeof ImageIcon;
  title: string;
  thumb?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-canvas/60 p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-accent" aria-hidden />
        <h4 className="text-ui font-semibold text-fg">{title}</h4>
      </div>
      {thumb}
      {children}
    </div>
  );
}

/** A plain line saying what AI can do here, and how sure that is. */
function Status({
  tone,
  children,
}: {
  tone: "ok" | "wait" | "no";
  children: ReactNode;
}) {
  return (
    <p
      className={cx(
        "flex items-start gap-1.5 text-2xs leading-4",
        tone === "ok"
          ? "text-ok"
          : tone === "wait"
            ? "text-fg-muted"
            : "text-fg-dim",
      )}
    >
      <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/**
 * One-click setup of Framebop's image runtime and the catalog models a row
 * needs: pictures need one model, clips a video model and its text encoder.
 */
function useModelSetup(
  modelIds: string[],
  copy: { title: string; message: (size: string) => string },
) {
  const models = useStudio((state) => state.models);
  const refreshEngines = useStudio((state) => state.refreshEngines);
  const refreshModels = useStudio((state) => state.refreshModels);
  const notify = useStudio((state) => state.notify);
  const [runtime, setRuntime] = useState<ImageRuntimeStatus | null>(null);
  // The model list is loaded on first use.
  const modelsState = useStudio((state) => state.modelsState);
  useEffect(() => {
    if (modelsState === "idle") void refreshModels();
  }, [modelsState, refreshModels]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void bridge
      .call("runtimes.imageStatus", {})
      .then(setRuntime)
      .catch(() => {});
  }, []);
  // Parts other models provide come first, so each is queued only once.
  const ids = [
    ...new Set(
      modelIds.flatMap((id) => [
        ...(
          models.find((item) => item.entry.id === id)?.entry.parts ?? []
        ).flatMap((part) => (part.model ? [part.model] : [])),
        id,
      ]),
    ),
  ];
  const parts = ids.map((id) => {
    const model = models.find((item) => item.entry.id === id);
    const installation = model?.installation ?? null;
    return {
      id,
      model,
      installation,
      ready:
        installation?.state === "installed" &&
        installation.verification === "verified",
      downloading:
        installation !== null &&
        ["queued", "downloading", "verifying"].includes(installation.state),
    };
  });
  const runtimeReady = runtime?.state === "installed";
  const modelsReady = parts.every((part) => part.ready);
  const downloading = parts.some((part) => part.downloading);
  const size =
    (runtimeReady ? 0 : (runtime?.downloadBytes ?? 0)) +
    parts.reduce(
      (total, part) =>
        part.ready || part.downloading
          ? total
          : total + (part.model?.downloadSizeBytes ?? 0),
      0,
    );
  const transfers = parts.flatMap((part) =>
    part.downloading && part.installation ? [part.installation] : [],
  );
  const bytesTotal = transfers.reduce((sum, item) => sum + item.bytesTotal, 0);
  const bytesDone = transfers.reduce((sum, item) => sum + item.bytesDone, 0);

  const prepare = async () => {
    const agreed = await confirm({
      title: copy.title,
      message: copy.message(formatBytes(size)),
      confirmLabel: t("create:prepareButton", { size: formatBytes(size) }),
    });
    if (!agreed) return;
    setBusy(true);
    try {
      if (!runtimeReady) {
        setRuntime(
          await bridge.call("runtimes.installImage", { approved: true }),
        );
        await refreshEngines();
      }
      for (const part of parts) {
        if (part.ready || part.downloading) continue;
        await bridge.call("models.install", {
          modelId: part.id,
          approved: true,
        });
      }
      await refreshModels();
    } catch (error) {
      notify("error", errorMessage(error, t("create:prepareFailed")));
    } finally {
      setBusy(false);
    }
  };
  return {
    unsupported:
      runtime?.state === "unsupported" ||
      (runtime !== null &&
        modelsState === "ready" &&
        parts.some((part) => !part.model)),
    needed: !runtimeReady || !modelsReady,
    downloading,
    progress: bytesTotal > 0 ? bytesDone / bytesTotal : null,
    busy: busy || runtime?.state === "installing",
    size,
    prepare,
  };
}

/** One-click setup of the voice engine and a voice for the language. */
function useVoiceSetup(language: string) {
  const refreshEngines = useStudio((state) => state.refreshEngines);
  const notify = useStudio((state) => state.notify);
  const [status, setStatus] = useState<VoiceSetupStatus | null>(null);
  const installing = status?.runtime.state === "installing";
  useEffect(() => {
    void bridge
      .call("runtimes.voiceStatus", {})
      .then(setStatus)
      .catch(() => {});
  }, []);
  // Follow a download until it is done, then let the engine list catch up.
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(() => {
      void bridge
        .call("runtimes.voiceStatus", {})
        .then((next) => {
          setStatus(next);
          if (next.runtime.state === "installing") return;
          if (next.error) {
            notify("error", `${t("create:prepareFailed")} ${next.error}`);
          }
          void refreshEngines();
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [installing, notify, refreshEngines]);

  const base = language.toLowerCase().split("-")[0];
  const pack =
    status?.packs.find(
      (item) => item.language.toLowerCase() === language.toLowerCase(),
    ) ??
    status?.packs.find(
      (item) => item.language.toLowerCase().split("-")[0] === base,
    ) ??
    null;
  const runtimeReady = status?.runtime.state === "installed";
  const size =
    (runtimeReady ? 0 : (status?.runtime.downloadBytes ?? 0)) +
    (pack && pack.state !== "installed" ? pack.downloadBytes : 0);
  const prepare = async () => {
    const languageName =
      new Intl.DisplayNames([currentLanguage()], { type: "language" }).of(
        language,
      ) ?? language;
    const agreed = await confirm({
      title: t("create:voicePrepareTitle"),
      message: t("create:voicePrepareMessage", {
        language: languageName,
        size: formatBytes(size),
      }),
      confirmLabel: t("create:prepareButton", { size: formatBytes(size) }),
    });
    if (!agreed) return;
    try {
      setStatus(
        await bridge.call("runtimes.installVoice", {
          approved: true,
          language,
        }),
      );
    } catch (error) {
      notify("error", errorMessage(error, t("create:prepareFailed")));
    }
  };
  return {
    pack: pack?.state === "installed" ? pack.id : null,
    unsupported:
      status !== null && (status.runtime.state === "unsupported" || !pack),
    installing,
    progress:
      status?.progress && status.progress.bytesTotal > 0
        ? status.progress.bytesDone / status.progress.bytesTotal
        : null,
    size,
    prepare,
  };
}

export function QuickCreate({ scene }: { scene: Scene }) {
  const editScene = useStudio((state) => state.editScene);
  const importMedia = useStudio((state) => state.importMedia);
  const createGenerationJob = useStudio((state) => state.createGenerationJob);
  const assets = useStudio((state) => state.assets);
  const jobs = useStudio((state) => state.jobs);
  const picture = useAi("image_generation", IMAGE_ENGINE);
  const language = useStudio(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.language ?? "en",
  );
  const voiceSetup = useVoiceSetup(language);
  const voice = useAi("audio_generation", VOICE_ENGINE, voiceSetup.pack);

  const setup = useModelSetup([IMAGE_MODEL], {
    title: t("create:prepareTitle"),
    message: (size) => t("create:prepareMessage", { size }),
  });

  const running = (task: Task) =>
    jobs.find(
      (job) =>
        job.type === task && job.sceneId === scene.id && isActiveJob(job),
    );
  const make = (
    task: Task,
    option: { engine: EngineStatus; capability: EngineCapability },
    choice: ModelChoice,
  ) => {
    // The model's own settings, when the catalog gives some.
    const preset = choice.presets[0];
    const size = preset?.size ?? option.capability.resolutions[0];
    return createGenerationJob({
      sceneId: scene.id,
      task,
      engine: option.engine,
      model: choice.reference,
      ...(task === "audio_generation" || !size
        ? {}
        : { width: size.width, height: size.height }),
      parameters: { ...defaults(option.capability), ...preset?.parameters },
      // The button says what happens and roughly how long it takes.
      confirmed: true,
    });
  };

  const image = scene.imageAssetId
    ? (assets[scene.imageAssetId] ?? null)
    : null;

  const pictureJob = running("image_generation");
  const voiceJob = running("audio_generation");
  const pictureReady = Boolean(
    picture.option?.capability.available && picture.choice,
  );
  const voiceReady = Boolean(
    voice.option?.capability.available && voice.choice && voiceSetup.pack,
  );

  return (
    <Section title={t("create:title")}>
      <p className="text-2xs leading-4 text-fg-dim">{t("create:intro")}</p>

      <Row
        icon={ImageIcon}
        title={t("create:picture")}
        thumb={
          <AssetThumb
            asset={image}
            className="aspect-video w-full rounded-lg border border-line"
          />
        }
      >
        <textarea
          rows={2}
          aria-label={t("create:pictureAsk")}
          placeholder={t("create:pictureAsk")}
          className="control resize-y text-xs"
          value={scene.imagePrompt}
          onChange={(event) =>
            editScene(scene.id, { imagePrompt: event.target.value })
          }
        />
        {pictureJob ? (
          <ActiveRun job={pictureJob} />
        ) : pictureReady ? (
          <Status tone="ok">{t("create:pictureReady")}</Status>
        ) : setup.unsupported ? (
          <Status tone="no">{t("create:pictureUnsupported")}</Status>
        ) : setup.downloading ? (
          <div className="flex flex-col gap-1">
            <Status tone="wait">
              {t("create:preparing", {
                percent:
                  setup.progress === null
                    ? 0
                    : Math.floor(setup.progress * 100),
              })}
            </Status>
            <ProgressBar value={setup.progress} />
          </div>
        ) : (
          <Status tone="wait">
            {t("create:pictureNeedsSetup", { size: formatBytes(setup.size) })}
          </Status>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {pictureReady && picture.option && picture.choice ? (
            <Button
              variant="primary"
              icon={Sparkles}
              className={PAIR}
              disabled={Boolean(pictureJob) || !scene.imagePrompt.trim()}
              title={
                scene.imagePrompt.trim()
                  ? undefined
                  : t("create:pictureAskFirst")
              }
              onClick={() =>
                picture.option &&
                picture.choice &&
                void make("image_generation", picture.option, picture.choice)
              }
            >
              {image ? t("create:pictureAgain") : t("create:pictureMake")}
            </Button>
          ) : (
            !setup.unsupported &&
            !setup.downloading && (
              <Button
                variant="primary"
                icon={Sparkles}
                className={PAIR}
                busy={setup.busy}
                onClick={() => void setup.prepare()}
              >
                {t("create:prepareButton", { size: formatBytes(setup.size) })}
              </Button>
            )
          )}
          <Button
            className={PAIR}
            icon={Upload}
            onClick={() => void importMedia(scene.id, "image")}
          >
            {t("create:addOwnPicture")}
          </Button>
        </div>
      </Row>

      <Row icon={AudioLines} title={t("create:voice")}>
        <textarea
          rows={2}
          aria-label={t("create:voiceAsk")}
          placeholder={t("create:voiceAsk")}
          className="control resize-y text-xs"
          value={scene.narrationText}
          onChange={(event) =>
            editScene(scene.id, { narrationText: event.target.value })
          }
        />
        {voiceJob ? (
          <ActiveRun job={voiceJob} />
        ) : voiceReady ? (
          <Status tone="ok">{t("create:voiceReady")}</Status>
        ) : voiceSetup.unsupported ? (
          <Status tone="no">{t("create:voiceUnsupported")}</Status>
        ) : voiceSetup.installing ? (
          <div className="flex flex-col gap-1">
            <Status tone="wait">
              {t("create:preparing", {
                percent:
                  voiceSetup.progress === null
                    ? 0
                    : Math.floor(voiceSetup.progress * 100),
              })}
            </Status>
            <ProgressBar value={voiceSetup.progress} />
          </div>
        ) : (
          <Status tone="wait">
            {t("create:voiceNeedsSetup", {
              size: formatBytes(voiceSetup.size),
            })}
          </Status>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {voiceReady && voice.option && voice.choice ? (
            <Button
              variant="primary"
              icon={Sparkles}
              className={PAIR}
              disabled={Boolean(voiceJob) || !scene.narrationText.trim()}
              onClick={() =>
                voice.option &&
                voice.choice &&
                void make("audio_generation", voice.option, voice.choice)
              }
            >
              {scene.audioAssetId
                ? t("create:voiceAgain")
                : t("create:voiceMake")}
            </Button>
          ) : (
            !voiceSetup.unsupported && (
              <Button
                variant="primary"
                className={PAIR}
                icon={Sparkles}
                busy={voiceSetup.installing}
                onClick={() => void voiceSetup.prepare()}
              >
                {t("create:voiceSetUp")}
              </Button>
            )
          )}
          <Button
            className={PAIR}
            icon={Upload}
            onClick={() => void importMedia(scene.id, "audio")}
          >
            {t("create:addOwnVoice")}
          </Button>
        </div>
      </Row>

      <VideoStudio key={scene.id} scene={scene} />
    </Section>
  );
}
