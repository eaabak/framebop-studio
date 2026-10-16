import {
  SCENE_DURATION_MAX,
  SCENE_DURATION_MIN,
  formatDuration,
} from "@framebop/core";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Info,
  ShieldCheck,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { bridge } from "../lib/bridge";
import { closeMediaPreview, closePanel, useDialogs } from "../lib/dialogs";
import { LANGUAGES, languageName } from "../lib/languages";
import { clientOs, fileManagerName } from "../lib/platform";
import { useStudio } from "../store/studio";
import { Button, Field, IconButton, Modal, cx } from "./ui";
import { YouTubeKeySetting } from "../views/research/KeySetting";
import { currentLanguage, formatBytes, t } from "../i18n";
import { NATIVE_NAMES, UI_LANGUAGES, type UiLanguage } from "../i18n/languages";

function NewProjectDialog() {
  const createProject = useStudio((state) => state.createProject);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("8");
  const [language, setLanguage] = useState("en");
  const [visualStyle, setVisualStyle] = useState("");
  const [busy, setBusy] = useState(false);

  const targetSeconds = Math.round(Number(minutes) * 60);
  const minutesValid =
    Number.isFinite(targetSeconds) &&
    targetSeconds >= 5 &&
    targetSeconds <= 6 * 3600;
  const valid = name.trim().length > 0 && minutesValid;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const created = await createProject({
      name,
      description,
      targetDurationSeconds: targetSeconds,
      language,
      visualStyle,
    });
    setBusy(false);
    if (created) closePanel();
  }

  return (
    <Modal
      title={t("dialogs:newProject")}
      onClose={closePanel}
      footer={
        <>
          <Button variant="ghost" onClick={closePanel}>
            {t("dialogs:cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="new-project"
            disabled={!valid}
            busy={busy}
          >
            {t("dialogs:createProject")}
          </Button>
        </>
      }
    >
      <form
        id="new-project"
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-4"
      >
        <Field label={t("dialogs:name")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={name}
              maxLength={120}
              placeholder={t("dialogs:ancientRome")}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("dialogs:description")}
          hint={t("dialogs:whatTheSeriesOrFilmIs")}
        >
          {(id) => (
            <textarea
              id={id}
              className="control"
              rows={2}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("dialogs:targetLengthMinutes")}
            error={minutesValid ? null : t("dialogs:between01And360Minutes")}
          >
            {(id) => (
              <input
                id={id}
                className="control"
                type="number"
                min={0.1}
                max={360}
                step="any"
                value={minutes}
                aria-invalid={!minutesValid}
                onChange={(event) => setMinutes(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("dialogs:narrationLanguage")}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field
          label={t("dialogs:visualStyle")}
          hint={t("dialogs:aNoteForYourselfForNow")}
        >
          {(id) => (
            <input
              id={id}
              className="control"
              value={visualStyle}
              maxLength={500}
              placeholder={t("dialogs:painterlyWarmLight2dAnimation")}
              onChange={(event) => setVisualStyle(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

function NewEpisodeDialog() {
  const createEpisode = useStudio((state) => state.createEpisode);
  const episodeCount = useStudio((state) => state.episodes.length);
  const [title, setTitle] = useState(`Episode ${episodeCount + 1}`);
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const created = await createEpisode(title);
    setBusy(false);
    if (created) closePanel();
  }

  return (
    <Modal
      title={t("dialogs:newEpisode")}
      width="sm"
      onClose={closePanel}
      footer={
        <>
          <Button variant="ghost" onClick={closePanel}>
            {t("dialogs:cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="new-episode"
            disabled={!valid}
            busy={busy}
          >
            {t("dialogs:createEpisode")}
          </Button>
        </>
      }
    >
      <form id="new-episode" noValidate onSubmit={submit}>
        <Field label={t("dialogs:title")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Where a newer model registry can be fetched from, on request. */
function RegistryUrlSetting() {
  const url = useStudio((state) => state.settings.registryUrl);
  const updateSettings = useStudio((state) => state.updateSettings);
  const [draft, setDraft] = useState(url ?? "");
  useEffect(() => setDraft(url ?? ""), [url]);
  const commit = () => {
    const next = draft.trim() || null;
    if (next !== url) void updateSettings({ registryUrl: next });
  };
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="text-ui text-fg">{t("dialogs:modelRegistryAddress")}</div>
      <div className="text-2xs leading-4 text-fg-dim">
        {t("dialogs:whereANewerFramebopModelRegistry")}
      </div>
      <input
        aria-label={t("dialogs:modelRegistryAddress")}
        className="control"
        placeholder="https://…/framebop-registry.json"
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}

function ProgramSetting({
  setting,
  label,
  hint,
}: {
  setting: "kokoroPython" | "rendererBrowserPath" | "llamaServerPath";
  label: string;
  hint: string;
}) {
  const path = useStudio((state) => state.settings[setting]);
  const chooseProgram = useStudio((state) => state.chooseProgram);
  const updateSettings = useStudio((state) => state.updateSettings);
  const refreshEngines = useStudio((state) => state.refreshEngines);
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-ui text-fg">{label}</div>
          <div className="text-2xs leading-4 text-fg-dim">{hint}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" onClick={() => void chooseProgram(setting)}>
            {path ? t("dialogs:change") : t("dialogs:choose")}
          </Button>
          {path && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await updateSettings({ [setting]: null });
                void refreshEngines();
              }}
            >
              {t("dialogs:clear")}
            </Button>
          )}
        </div>
      </div>
      <code
        data-selectable
        className="block rounded bg-raised px-2 py-1 font-mono text-2xs break-all text-fg-muted"
      >
        {path ?? t("dialogs:notChosen")}
      </code>
    </div>
  );
}

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-ui text-fg">{label}</div>
        {hint && <div className="text-2xs leading-4 text-fg-dim">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A number box that commits only valid values, on blur or Enter. */
function NumberSetting({
  value,
  min,
  max,
  step,
  onCommit,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      if (parsed !== value) onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };
  return (
    <input
      aria-label={label}
      className="control w-24 text-right tabular-nums"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function SettingsDialog() {
  const settings = useStudio((state) => state.settings);
  const system = useStudio((state) => state.system);
  const updateSettings = useStudio((state) => state.updateSettings);
  const notify = useStudio((state) => state.notify);

  const reveal = (path: string) =>
    bridge
      .revealInFileManager(path)
      .catch(() => notify("error", t("dialogs:theFolderCouldNotBeOpened")));

  return (
    <Modal title={t("dialogs:settings")} width="lg" onClose={closePanel}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="eyebrow mb-1">{t("dialogs:interfaceLanguage")}</h3>
          <div className="divide-y divide-line">
            <SettingsRow
              label={t("dialogs:language")}
              hint={
                settings.uiLanguage === "system"
                  ? t("dialogs:followsSystem", {
                      language: NATIVE_NAMES[currentLanguage()],
                    })
                  : t("dialogs:languageIndependent")
              }
            >
              <select
                aria-label={t("dialogs:language")}
                className="control"
                value={settings.uiLanguage}
                onChange={(event) =>
                  void updateSettings({
                    uiLanguage: event.target.value as "system" | UiLanguage,
                  })
                }
              >
                <option value="system">{t("dialogs:systemDefault")}</option>
                {UI_LANGUAGES.map((code) => (
                  <option key={code} value={code} lang={code}>
                    {NATIVE_NAMES[code]}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </div>
        </section>
        <section>
          <h3 className="eyebrow mb-1">{t("dialogs:editing")}</h3>
          <div className="divide-y divide-line">
            <SettingsRow
              label={t("dialogs:defaultSceneLength")}
              hint={t("dialogs:appliedToScenesYouAddBy")}
            >
              <NumberSetting
                label={t("dialogs:defaultSceneLengthInSeconds")}
                value={settings.defaultSceneDurationSeconds}
                min={SCENE_DURATION_MIN}
                max={SCENE_DURATION_MAX}
                step={0.5}
                onCommit={(value) =>
                  void updateSettings({ defaultSceneDurationSeconds: value })
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t("dialogs:narrationPace")}
              hint={t("dialogs:wordsPerMinuteUsedToEstimate")}
            >
              <NumberSetting
                label={t("dialogs:narrationPaceInWordsPerMinute")}
                value={settings.narrationWordsPerMinute}
                min={80}
                max={260}
                step={5}
                onCommit={(value) =>
                  void updateSettings({
                    narrationWordsPerMinute: Math.round(value),
                  })
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t("dialogs:continuousPlayback")}
              hint={t("dialogs:whenASceneFinishesInThe")}
            >
              <input
                type="checkbox"
                aria-label={t("dialogs:continuousPlayback")}
                className="size-4 accent-accent"
                checked={settings.continuousPlayback}
                onChange={(event) =>
                  void updateSettings({
                    continuousPlayback: event.target.checked,
                  })
                }
              />
            </SettingsRow>
          </div>
        </section>

        <section>
          <h3 className="eyebrow mb-1">{t("dialogs:engines")}</h3>
          <div className="divide-y divide-line">
            <SettingsRow
              label={t("dialogs:drawThingsApiPort")}
              hint={t("dialogs:portOfTheHttpApiServer")}
            >
              <NumberSetting
                label={t("dialogs:drawThingsApiPort")}
                value={settings.drawThingsHttpPort}
                min={1024}
                max={65535}
                step={1}
                onCommit={(value) =>
                  void updateSettings({ drawThingsHttpPort: Math.round(value) })
                }
              />
            </SettingsRow>
            <RegistryUrlSetting />
            <ProgramSetting
              setting="llamaServerPath"
              label={t("dialogs:languageModelsLlamaServer")}
              hint={t("dialogs:theLlamaServerProgramFromA")}
            />
            <YouTubeKeySetting />
            <ProgramSetting
              setting="kokoroPython"
              label={t("dialogs:speechPythonWithKokoro")}
              hint={t("dialogs:anInterpreterWhereTheKokoroPackage")}
            />
            <ProgramSetting
              setting="rendererBrowserPath"
              label={t("dialogs:renderingChromeBuild")}
              hint={t("dialogs:theHeadlessChromeThatRemotionRenders")}
            />
          </div>
        </section>

        {system && (
          <section>
            <h3 className="eyebrow mb-2">{t("dialogs:library")}</h3>
            <div className="rounded-lg border border-line bg-canvas p-3">
              <p className="mb-2 text-xs leading-5 text-fg-muted">
                {t("dialogs:projectsTheDatabaseAndCopiesOf")}
              </p>
              <code
                data-selectable
                className="block rounded bg-raised px-2 py-1.5 font-mono text-2xs break-all text-fg-muted"
              >
                {system.dataDir}
              </code>
              {bridge.native && (
                <Button
                  size="sm"
                  icon={FolderOpen}
                  className="mt-2.5"
                  onClick={() => void reveal(system.databasePath)}
                >
                  {t("dialogs:showIn", { clientOs: fileManagerName[clientOs] })}
                </Button>
              )}
            </div>
          </section>
        )}

        <section>
          <h3 className="eyebrow mb-2">{t("dialogs:privacy")}</h3>
          <div className="flex gap-2.5 rounded-lg border border-ok/20 bg-ok/5 p-3">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-ok"
              aria-hidden
            />
            <p className="text-xs leading-5 text-fg-muted">
              {t("dialogs:framebopStudioRunsEntirelyOnThis")}
            </p>
          </div>
        </section>

        {system && (
          <section>
            <h3 className="eyebrow mb-2">{t("dialogs:about")}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
              {[
                [t("dialogs:version"), system.appVersion],
                [
                  t("dialogs:libraryFormat"),
                  t("dialogs:schema", { schemaVersion: system.schemaVersion }),
                ],
                [
                  t("dialogs:engineRuntime"),
                  t("dialogs:nodeJs", {
                    runtimeVersion: system.runtimeVersion,
                  }),
                ],
                [
                  t("dialogs:system"),
                  `${system.platform} ${system.arch} · ${system.hardware.cpuModel}`,
                ],
                [
                  t("dialogs:memory"),
                  formatBytes(system.hardware.totalMemoryBytes),
                ],
              ].map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-fg-dim">{label}</dt>
                  <dd data-selectable className="text-fg-muted">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </Modal>
  );
}

function RequestDialog() {
  const request = useDialogs((state) => state.request);
  const [path, setPath] = useState("");
  if (!request) return null;

  const close = () => {
    useDialogs.setState({ request: null });
    setPath("");
  };

  if (request.kind === "confirm") {
    const answer = (confirmed: boolean) => {
      request.resolve(confirmed);
      close();
    };
    return (
      <Modal
        title={request.title}
        width="sm"
        onClose={() => answer(false)}
        footer={
          <>
            <Button
              variant="ghost"
              data-autofocus
              onClick={() => answer(false)}
            >
              {t("dialogs:cancel")}
            </Button>
            <Button
              variant={request.tone === "danger" ? "danger" : "primary"}
              onClick={() => answer(true)}
            >
              {request.confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-ui leading-5 text-fg-muted">{request.message}</p>
      </Modal>
    );
  }

  const answer = (value: string | null) => {
    request.resolve(value);
    close();
  };
  return (
    <Modal
      title={request.title}
      onClose={() => answer(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(null)}>
            {t("dialogs:cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="path-prompt"
            disabled={path.trim().length === 0}
          >
            {request.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id="path-prompt"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (path.trim()) answer(path.trim());
        }}
      >
        <p className="text-xs leading-5 text-fg-muted">{request.message}</p>
        <input
          className="control font-mono text-xs"
          aria-label={t("dialogs:path")}
          value={path}
          placeholder={request.placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPath(event.target.value)}
        />
      </form>
    </Modal>
  );
}

/** A larger look at one asset, such as a job's result before it is used. */
function MediaPreview() {
  const asset = useDialogs((state) => state.preview);
  if (!asset) return null;
  const details = [
    asset.origin === "generated"
      ? t("dialogs:generated")
      : t("dialogs:imported"),
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
    asset.durationSeconds ? formatDuration(asset.durationSeconds) : null,
    formatBytes(asset.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal title={t("dialogs:preview")} width="lg" onClose={closeMediaPreview}>
      <div className="flex flex-col gap-3">
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-stage">
          {asset.kind === "video" ? (
            <video
              src={bridge.mediaUrl(asset, "file")}
              controls
              autoPlay
              loop
              playsInline
              className="size-full object-contain"
            />
          ) : asset.kind === "image" ? (
            <img
              src={bridge.mediaUrl(asset, "file")}
              alt=""
              className="size-full object-contain"
            />
          ) : (
            <audio controls src={bridge.mediaUrl(asset, "file")} />
          )}
        </div>
        <p className="timecode text-2xs text-fg-dim">{details}</p>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const panel = useDialogs((state) => state.panel);
  return (
    <>
      <MediaPreview />
      {panel === "newProject" && <NewProjectDialog />}
      {panel === "newEpisode" && <NewEpisodeDialog />}
      {panel === "settings" && <SettingsDialog />}
      <RequestDialog />
    </>
  );
}

const TOAST_ICONS = { error: AlertCircle, success: CheckCircle2, info: Info };
const TOAST_TONES = {
  error: "border-danger/40 text-danger",
  success: "border-ok/40 text-ok",
  info: "border-line-strong text-accent",
};

export function Toasts() {
  const toasts = useStudio((state) => state.toasts);
  const dismissToast = useStudio((state) => state.dismissToast);
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-12 z-[60] flex w-96 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = TOAST_ICONS[toast.tone];
        return (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cx(
              "glass-panel pointer-events-auto flex items-start gap-2.5 rounded-xl border py-2.5 pr-2 pl-3 animate-rise",
              TOAST_TONES[toast.tone],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p
              data-selectable
              className="min-w-0 flex-1 text-xs leading-5 break-words text-fg"
            >
              {toast.message}
            </p>
            <IconButton
              label={t("dialogs:dismiss")}
              icon={X}
              size="sm"
              onClick={() => dismissToast(toast.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
