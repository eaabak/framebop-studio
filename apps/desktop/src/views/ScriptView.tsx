import {
  countWords,
  estimateNarrationSeconds,
  formatDuration,
  splitScriptIntoScenes,
} from "@framebop/core";
import { ListPlus, Replace, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ErrorState, ProgressBar, Spinner } from "../components/ui";
import { useStudio } from "../store/studio";
import { NoEpisode } from "./ScenesView";
import type { ImageRuntimeStatus } from "@framebop/core";
import { currentLanguage, formatBytes, t } from "../i18n";
import { bridge } from "../lib/bridge";
import { confirm } from "../lib/dialogs";
import { errorMessage } from "../lib/errors";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-2xs text-fg-dim">{label}</dt>
      <dd
        className={
          tone === "warn"
            ? "timecode text-sm text-warn"
            : "timecode text-sm text-fg"
        }
      >
        {value}
      </dd>
    </div>
  );
}

export function ScriptView() {
  const episode = useStudio((state) => state.episode);
  const episodeState = useStudio((state) => state.episodeState);
  const episodeError = useStudio((state) => state.episodeError);
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const editEpisode = useStudio((state) => state.editEpisode);
  const openEpisode = useStudio((state) => state.openEpisode);

  // The title is committed on blur, so it can be cleared while retyping
  // without ever saving an empty title.
  const [title, setTitle] = useState(episode?.title ?? "");
  useEffect(
    () => setTitle(episode?.title ?? ""),
    [episode?.id, episode?.title],
  );

  const script = episode?.script ?? "";

  if (!activeEpisodeId)
    return <NoEpisode purpose={t("editor:writeItsScript")} />;
  if (episodeState === "error") {
    return (
      <ErrorState
        message={episodeError ?? t("editor:theEpisodeCouldNotBeLoaded")}
        onRetry={() => void openEpisode(activeEpisodeId)}
      />
    );
  }
  if (!episode) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col px-8 pt-6 pb-4">
        <input
          aria-label={t("editor:episodeTitle")}
          className="mb-1 w-full bg-transparent text-xl font-semibold tracking-tight text-fg outline-none placeholder:text-fg-dim"
          value={title}
          maxLength={160}
          placeholder={t("editor:episodeTitle")}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next.length === 0) setTitle(episode.title);
            else if (next !== episode.title) editEpisode({ title: next });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <p className="mb-4 text-xs text-fg-muted">
          {t("editor:oneParagraphBecomesOneSceneA")}{" "}
          <code className="font-mono text-fg">#</code>{" "}
          {t("editor:orScene3NamesTheScene")}
        </p>
        <textarea
          aria-label={t("editor:script")}
          className="control min-h-0 flex-1 px-5 py-4 text-sm leading-7"
          value={script}
          maxLength={200_000}
          spellCheck
          placeholder={t("editor:dawnInTheForumBeforeSunrise")}
          onChange={(event) => editEpisode({ script: event.target.value })}
        />
      </div>
    </div>
  );
}

/**
 * The script's length and the scenes it would become, as a panel of its
 * own beside the editor.
 */
export function ScriptSidePanel() {
  const episode = useStudio((state) => state.episode);
  const sceneCount = useStudio((state) => state.scenes.length);
  const wordsPerMinute = useStudio(
    (state) => state.settings.narrationWordsPerMinute,
  );
  const targetSeconds = useStudio(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.targetDurationSeconds ?? 0,
  );
  const createScenesFromScript = useStudio(
    (state) => state.createScenesFromScript,
  );
  const [busy, setBusy] = useState<"append" | "replace" | null>(null);
  const script = episode?.script ?? "";
  const drafts = useMemo(
    () => splitScriptIntoScenes(script, { wordsPerMinute }),
    [script, wordsPerMinute],
  );
  if (!episode) return null;

  const words = countWords(script);
  const narrationSeconds = estimateNarrationSeconds(script, wordsPerMinute);
  const scenesSeconds = drafts.reduce(
    (total, draft) => total + draft.durationSeconds,
    0,
  );
  const run = async (mode: "append" | "replace") => {
    setBusy(mode);
    await createScenesFromScript(mode);
    setBusy(null);
  };

  return (
    <aside
      aria-label={t("editor:scriptTools")}
      className="glass flex w-80 shrink-0 flex-col overflow-y-auto rounded-2xl border"
    >
      <section className="border-b border-line p-4">
        <h2 className="eyebrow mb-3">{t("editor:length")}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat
            label={t("editor:words")}
            value={words.toLocaleString(currentLanguage())}
          />
          <Stat
            label={t("editor:scenesInScript")}
            value={String(drafts.length)}
          />
          <Stat
            label={t("editor:narrationAtWpm", { wordsPerMinute })}
            value={formatDuration(narrationSeconds)}
            tone={
              targetSeconds > 0 && narrationSeconds > targetSeconds
                ? "warn"
                : undefined
            }
          />
          <Stat
            label={t("editor:projectTarget")}
            value={formatDuration(targetSeconds)}
          />
        </dl>
        <p className="mt-3 text-2xs leading-4 text-fg-dim">
          {t("editor:narrationTimeIsAnEstimateFrom")}
        </p>
      </section>

      <section className="border-b border-line p-4">
        <h2 className="eyebrow mb-2">{t("editor:scenesFromScript")}</h2>
        {drafts.length === 0 ? (
          <p className="text-xs leading-5 text-fg-muted">
            {t("editor:writeOrPasteAScriptTo")}
          </p>
        ) : (
          <>
            <ol className="mb-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {drafts.map((draft, index) => (
                <li
                  // Drafts have no identity of their own; position is the key.
                  key={`${index}-${draft.title}`}
                  className="flex items-baseline gap-2 rounded border border-line bg-canvas px-2 py-1.5"
                >
                  <span className="timecode shrink-0 text-2xs text-fg-dim">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                    {draft.title}
                  </span>
                  <span className="timecode shrink-0 text-2xs text-fg-dim">
                    {formatDuration(draft.durationSeconds)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mb-3 text-2xs text-fg-dim">
              {t("editor:draftScenesTotal", {
                count: drafts.length,
                duration: formatDuration(scenesSeconds),
              })}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                icon={ListPlus}
                busy={busy === "append"}
                disabled={busy !== null}
                onClick={() => void run("append")}
              >
                {sceneCount === 0
                  ? t("editor:createScenes")
                  : t("editor:addAfterTheExisting", { sceneCount })}
              </Button>
              {sceneCount > 0 && (
                <Button
                  icon={Replace}
                  busy={busy === "replace"}
                  disabled={busy !== null}
                  onClick={() => void run("replace")}
                >
                  {t("editor:replaceAllScenes")}
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <ScriptWriter />
    </aside>
  );
}

/** The catalog model the one-click setup installs for writing. */
const SCRIPT_MODEL = "qwen3-4b-q4km";

/**
 * "Write with AI": a topic in, a script draft out, from the local language
 * model. The draft is shown first; it goes into the script only when the
 * user chooses to.
 */
function ScriptWriter() {
  const episode = useStudio((state) => state.episode);
  const editEpisode = useStudio((state) => state.editEpisode);
  const models = useStudio((state) => state.models);
  const refreshModels = useStudio((state) => state.refreshModels);
  const notify = useStudio((state) => state.notify);
  const [runtime, setRuntime] = useState<ImageRuntimeStatus | null>(null);
  // The model list is loaded on first use.
  const modelsState = useStudio((state) => state.modelsState);
  useEffect(() => {
    if (modelsState === "idle") void refreshModels();
  }, [modelsState, refreshModels]);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState<"setup" | "write" | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    void bridge
      .call("runtimes.llmStatus", {})
      .then(setRuntime)
      .catch(() => {});
  }, []);
  if (!episode) return null;

  const model = models.find((item) => item.entry.id === SCRIPT_MODEL);
  const installation = model?.installation ?? null;
  const modelReady =
    installation?.state === "installed" &&
    installation.verification === "verified";
  const downloading =
    installation !== null &&
    ["queued", "downloading", "verifying"].includes(installation.state);
  const runtimeReady = runtime?.state === "installed";
  const unsupported =
    runtime?.state === "unsupported" || (modelsState === "ready" && !model);
  const size =
    (runtimeReady ? 0 : (runtime?.downloadBytes ?? 0)) +
    (modelReady || downloading ? 0 : (model?.downloadSizeBytes ?? 0));

  const prepare = async () => {
    const agreed = await confirm({
      title: t("editor:writerPrepareTitle"),
      message: t("editor:writerPrepareMessage", { size: formatBytes(size) }),
      confirmLabel: t("create:prepareButton"),
    });
    if (!agreed) return;
    setBusy("setup");
    try {
      if (!runtimeReady) {
        setRuntime(
          await bridge.call("runtimes.installLlm", { approved: true }),
        );
      }
      if (!modelReady && !downloading) {
        await bridge.call("models.install", {
          modelId: SCRIPT_MODEL,
          approved: true,
        });
        await refreshModels();
      }
    } catch (error) {
      notify("error", errorMessage(error, t("create:prepareFailed")));
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    setBusy("write");
    setDraft(null);
    try {
      const result = await bridge.call("script.write", {
        episodeId: episode.id,
        topic: topic.trim(),
      });
      setDraft(result.script);
    } catch (error) {
      notify("error", errorMessage(error, t("editor:writerFailed")));
    } finally {
      setBusy(null);
    }
  };

  const existing = episode.script.trim();
  return (
    <section className="p-4">
      <h2 className="eyebrow mb-2 flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-accent" aria-hidden />
        {t("editor:writerTitle")}
      </h2>
      {unsupported ? (
        <p className="text-xs leading-5 text-fg-muted">
          {t("editor:writerUnsupported")}
        </p>
      ) : !runtimeReady || !modelReady ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-5 text-fg-muted">
            {downloading
              ? t("create:preparing", {
                  percent:
                    installation && installation.bytesTotal > 0
                      ? Math.floor(
                          (installation.bytesDone / installation.bytesTotal) *
                            100,
                        )
                      : 0,
                })
              : t("editor:writerNeedsSetup", { size: formatBytes(size) })}
          </p>
          {downloading ? (
            <ProgressBar
              value={
                installation && installation.bytesTotal > 0
                  ? installation.bytesDone / installation.bytesTotal
                  : null
              }
            />
          ) : (
            <Button
              variant="primary"
              icon={Sparkles}
              busy={busy === "setup"}
              onClick={() => void prepare()}
            >
              {t("create:prepareButton")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            rows={3}
            aria-label={t("editor:writerTopic")}
            placeholder={t("editor:writerTopic")}
            className="control resize-y text-xs"
            value={topic}
            maxLength={1000}
            onChange={(event) => setTopic(event.target.value)}
          />
          {busy === "write" ? (
            <div className="flex items-center gap-2">
              <Spinner className="size-4" />
              <span className="flex-1 text-xs text-fg-muted">
                {t("editor:writerWriting")}
              </span>
              <Button
                size="sm"
                icon={X}
                onClick={() => void bridge.call("script.cancel", {})}
              >
                {t("media:stop")}
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              icon={Sparkles}
              disabled={topic.trim().length < 3}
              onClick={() => void write()}
            >
              {t("editor:writerWrite")}
            </Button>
          )}
          {draft !== null && (
            <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 p-2.5">
              <p className="text-2xs font-medium text-accent">
                {t("editor:writerDraft")}
              </p>
              <pre className="max-h-48 overflow-y-auto font-sans text-2xs leading-4 whitespace-pre-wrap text-fg-muted">
                {draft}
              </pre>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="primary"
                  className="w-full min-w-0 px-2! text-xs!"
                  onClick={() => {
                    editEpisode({ script: draft });
                    setDraft(null);
                  }}
                >
                  {existing ? t("editor:writerReplace") : t("editor:writerUse")}
                </Button>
                {existing ? (
                  <Button
                    className="w-full min-w-0 px-2! text-xs!"
                    onClick={() => {
                      editEpisode({ script: `${existing}\n\n${draft}` });
                      setDraft(null);
                    }}
                  >
                    {t("editor:writerAppend")}
                  </Button>
                ) : (
                  <Button
                    className="w-full min-w-0 px-2! text-xs!"
                    onClick={() => setDraft(null)}
                  >
                    {t("editor:writerDiscard")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
