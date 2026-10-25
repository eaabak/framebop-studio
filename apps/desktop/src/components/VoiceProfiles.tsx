import {
  VOICE_CLONE_PARAGRAPH,
  VOICE_RECORDING_MAX_SECONDS,
  VOICE_RECORDING_MIN_SECONDS,
  VOICE_STYLES,
  type VoiceLibrary,
  type VoicePacing,
  type VoiceProfileInfo,
  VoiceSpeakerSchema,
  type VoiceStyle,
  consentSentence,
} from "@framebop/core";
import {
  AlertTriangle,
  Check,
  Mic,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { bridge } from "../lib/bridge";
import { confirm } from "../lib/dialogs";
import { errorMessage } from "../lib/errors";
import {
  MicRecorder,
  MicrophoneError,
  Player,
  type Recording,
  encodeWav,
  fromBase64,
  measure,
  meterPosition,
  toBase64,
} from "../lib/recorder";
import { useStudio } from "../store/studio";
import { Badge, Button, Field, Modal, Spinner, cx } from "./ui";

const STYLE_LABELS = {
  calm: "voices:styleCalm",
  lively: "voices:styleLively",
  mysterious: "voices:styleMysterious",
} as const;
const STYLE_HINTS = {
  calm: "voices:styleCalmHint",
  lively: "voices:styleLivelyHint",
  mysterious: "voices:styleMysteriousHint",
} as const;

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Settings may have changed in the engine (the folder of new voices). */
async function reloadSettings(): Promise<void> {
  const settings = await bridge.call("settings.get", {}).catch(() => null);
  if (settings) useStudio.setState({ settings });
}

/**
 * Speaks the sample sentence with a profile: starts it in the engine, waits
 * for it, and plays it.
 */
function useVoicePreview() {
  const notify = useStudio((state) => state.notify);
  const player = useRef<Player | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ id: string; wav: Uint8Array } | null>(
    null,
  );
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      player.current?.close();
    };
  }, []);

  const play = useCallback((wav: Uint8Array) => {
    player.current ??= new Player();
    void player.current.playWav(wav).catch(() => undefined);
  }, []);

  const start = useCallback(
    async (id: string) => {
      player.current?.stop();
      setBusyId(id);
      try {
        let status = await bridge.call("voices.preview", { id });
        while (status.state === "running" && alive.current) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          status = await bridge.call("voices.previewStatus", {});
        }
        if (!alive.current) return;
        if (status.state === "done" && status.audio) {
          const wav = fromBase64(status.audio);
          setHeard({ id, wav });
          play(wav);
        } else if (status.state === "failed") {
          notify(
            "error",
            `${t("voices:sampleFailed")} ${status.error ?? ""}`.trim(),
          );
        }
      } catch (error) {
        if (alive.current) {
          notify("error", errorMessage(error, t("voices:sampleFailed")));
        }
      } finally {
        if (alive.current) setBusyId(null);
      }
    },
    [notify, play],
  );

  return {
    busyId,
    /** Plays the sample again, or makes it first. */
    hear: (id: string) => (heard?.id === id ? play(heard.wav) : void start(id)),
    remake: (id: string) => void start(id),
    /** Drops a sample made before the profile changed. */
    forget: (id: string) =>
      setHeard((current) => (current?.id === id ? null : current)),
    heardId: heard?.id ?? null,
  };
}

function PaceInput({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      if (parsed !== value) onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };
  return (
    <label className="flex items-center justify-between gap-3 text-2xs text-fg-muted">
      <span>{label}</span>
      <input
        aria-label={label}
        className="control w-20 text-right tabular-nums"
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
    </label>
  );
}

function ProfileRow({
  profile,
  preview,
  onChanged,
}: {
  profile: VoiceProfileInfo;
  preview: ReturnType<typeof useVoicePreview>;
  onChanged: () => void;
}) {
  const notify = useStudio((state) => state.notify);
  const [pacing, setPacing] = useState(false);
  const busy = preview.busyId === profile.id;

  const savePace = async (patch: Partial<VoicePacing>) => {
    try {
      await bridge.call("voices.updatePacing", {
        id: profile.id,
        pacing: { ...profile.pacing, ...patch },
      });
      preview.forget(profile.id);
      onChanged();
    } catch (error) {
      notify("error", errorMessage(error, t("voices:couldNotSavePace")));
    }
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: t("voices:deleteTitle"),
      message: t("voices:deleteMessage", { name: profile.name }),
      confirmLabel: t("voices:delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await bridge.call("voices.delete", { id: profile.id });
      onChanged();
    } catch (error) {
      notify("error", errorMessage(error, t("voices:couldNotDelete")));
    }
  };

  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-ui text-fg">{profile.name}</span>
            <Badge tone={profile.ownRecording ? "accent" : "neutral"}>
              {profile.ownRecording
                ? t("voices:yourVoice")
                : t("voices:otherVoice")}
            </Badge>
          </div>
          <div className="text-2xs leading-4 text-fg-dim">
            {profile.style ? `${t(STYLE_LABELS[profile.style])} · ` : ""}
            {t("voices:seconds", {
              value: Math.round(profile.referenceSeconds),
            })}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            icon={Volume2}
            busy={busy}
            disabled={preview.busyId !== null && !busy}
            onClick={() => preview.hear(profile.id)}
          >
            {busy
              ? t("voices:makingSample")
              : preview.heardId === profile.id
                ? t("voices:playAgain")
                : t("voices:hearSample")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={pacing}
            onClick={() => setPacing(!pacing)}
          >
            {t("voices:pace")}
          </Button>
          {profile.ownRecording && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label={t("voices:delete")}
              onClick={() => void remove()}
            />
          )}
        </div>
      </div>
      {pacing && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-line bg-canvas p-2.5">
          <PaceInput
            label={t("voices:sentenceGap")}
            value={profile.pacing.sentenceGapSeconds}
            min={0}
            max={5}
            step={0.05}
            onCommit={(value) => void savePace({ sentenceGapSeconds: value })}
          />
          <PaceInput
            label={t("voices:paragraphGap")}
            value={profile.pacing.paragraphGapSeconds}
            min={0}
            max={10}
            step={0.1}
            onCommit={(value) => void savePace({ paragraphGapSeconds: value })}
          />
          <PaceInput
            label={t("voices:tempo")}
            value={profile.pacing.tempo}
            min={0.5}
            max={2}
            step={0.01}
            onCommit={(value) => void savePace({ tempo: value })}
          />
        </div>
      )}
    </li>
  );
}

/** Settings → Voice profiles: the Qwen3-TTS voices, and cloning your own. */
export function VoiceProfilesSection() {
  const folder = useStudio((state) => state.settings.qwenVoicesDirectory);
  const notify = useStudio((state) => state.notify);
  const [library, setLibrary] = useState<VoiceLibrary | null>(null);
  const [cloning, setCloning] = useState(false);
  const preview = useVoicePreview();

  const load = useCallback(async () => {
    try {
      setLibrary(await bridge.call("voices.list", {}));
    } catch (error) {
      notify("error", errorMessage(error, t("voices:couldNotLoad")));
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load, folder]);

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-4">
        <div>
          <h3 className="eyebrow">{t("voices:voiceProfiles")}</h3>
          <p className="text-2xs leading-4 text-fg-dim">
            {t("voices:voiceProfilesHint")}
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={Mic}
          onClick={() => setCloning(true)}
        >
          {t("voices:cloneYourVoice")}
        </Button>
      </div>
      {library === null ? (
        <Spinner />
      ) : library.profiles.length === 0 && library.problems.length === 0 ? (
        <p className="py-2.5 text-xs text-fg-muted">
          {t("voices:noProfilesYet")}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {library.profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              preview={preview}
              onChanged={() => void load()}
            />
          ))}
          {library.problems.map((problem) => (
            <li
              key={problem.id}
              className="flex gap-2 py-2.5 text-2xs leading-4 text-warn"
            >
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {t("voices:unusableProfile", {
                id: problem.id,
                reason: problem.reason,
              })}
            </li>
          ))}
        </ul>
      )}
      {/* Outside the Settings panel, whose animation would confine it. */}
      {cloning &&
        createPortal(
          <VoiceCloneDialog
            onSaved={() => {
              void reloadSettings();
              void load();
            }}
            onClose={() => setCloning(false)}
          />,
          document.body,
        )}
    </section>
  );
}

type Step = "consent" | "record" | "saved";

/**
 * Clone your voice: consent, a live recording of the shown text, cleanup
 * and saving in the engine, then a sample spoken with the new voice.
 */
function VoiceCloneDialog({
  onSaved,
  onClose,
}: {
  onSaved: () => void;
  onClose: () => void;
}) {
  const notify = useStudio((state) => state.notify);
  const [step, setStep] = useState<Step>("consent");
  const [speaker, setSpeaker] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [style, setStyle] = useState<VoiceStyle>("calm");
  const [recorded, setRecorded] = useState<VoiceStyle[]>([]);
  const [saved, setSaved] = useState<VoiceProfileInfo | null>(null);

  const [recording, setRecording] = useState<Recording | null>(null);
  const [active, setActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [loudest, setLoudest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const recorder = useRef<MicRecorder | null>(null);
  const player = useRef<Player | null>(null);
  const preview = useVoicePreview();

  const nameCheck = VoiceSpeakerSchema.safeParse(speaker);
  const name = nameCheck.success ? nameCheck.data : "";

  useEffect(
    () => () => {
      recorder.current?.cancel();
      player.current?.close();
    },
    [],
  );

  // The clock and the "loudest so far" hint, while recording.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setElapsed(recorder.current?.seconds ?? 0);
    }, 250);
    return () => clearInterval(timer);
  }, [active]);

  const stop = useCallback(() => {
    const current = recorder.current;
    if (!current) return;
    recorder.current = null;
    setActive(false);
    setLevel(0);
    setRecording(current.stop());
  }, []);

  const start = async () => {
    player.current?.stop();
    setProblem(null);
    setRecording(null);
    setElapsed(0);
    setLoudest(0);
    try {
      recorder.current = await MicRecorder.start(
        (peak) => {
          setLevel(peak);
          setLoudest((value) => Math.max(value, peak));
        },
        VOICE_RECORDING_MAX_SECONDS,
        // Called from the audio thread's callback; stop on the next tick.
        () => setTimeout(stop, 0),
      );
      setActive(true);
    } catch (error) {
      const kind = error instanceof MicrophoneError ? error.problem : "failed";
      setProblem(
        kind === "denied"
          ? t("voices:micDenied")
          : kind === "missing"
            ? t("voices:micMissing")
            : kind === "unsupported"
              ? t("voices:micUnsupported")
              : t("voices:micFailed"),
      );
    }
  };

  /** Problems the user can fix by recording again, in their language. */
  const checkRecording = (take: Recording): string | null => {
    if (take.seconds < VOICE_RECORDING_MIN_SECONDS) return t("voices:tooShort");
    const levels = measure(take.samples);
    if (levels.peak < 0.03) return t("voices:tooQuiet");
    if (levels.clipped > 0.002) return t("voices:tooLoud");
    return null;
  };

  const save = async () => {
    if (!recording) return;
    const issue = checkRecording(recording);
    if (issue) {
      setProblem(issue);
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const profile = await bridge.call("voices.saveRecording", {
        speaker: name,
        style,
        ownVoice: true,
        audio: toBase64(encodeWav(recording.samples, recording.sampleRate)),
      });
      setSaved(profile);
      setRecorded((list) => (list.includes(style) ? list : [...list, style]));
      setRecording(null);
      setStep("saved");
      onSaved();
      preview.remake(profile.id);
    } catch (error) {
      notify("error", errorMessage(error, t("voices:couldNotSave")));
    } finally {
      setSaving(false);
    }
  };

  const listen = () => {
    if (!recording) return;
    player.current ??= new Player();
    void player.current.playSamples(recording).catch(() => undefined);
  };

  const meter = meterPosition(level);
  const levelHint =
    loudest === 0
      ? null
      : level >= 0.98
        ? { tone: "text-danger", text: t("voices:levelLoud") }
        : active && elapsed > 3 && loudest < 0.08
          ? { tone: "text-warn", text: t("voices:levelQuiet") }
          : { tone: "text-ok", text: t("voices:levelGood") };

  const footer =
    step === "consent" ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t("voices:cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!nameCheck.success || !agreed}
          onClick={() => setStep("record")}
        >
          {t("voices:continue")}
        </Button>
      </>
    ) : step === "record" ? (
      <>
        <Button
          variant="ghost"
          disabled={active || saving}
          onClick={() => setStep(saved ? "saved" : "consent")}
        >
          {t("voices:back")}
        </Button>
        <Button
          variant="primary"
          icon={Check}
          busy={saving}
          disabled={!recording || active}
          onClick={() => void save()}
        >
          {saving ? t("voices:savingVoice") : t("voices:saveVoice")}
        </Button>
      </>
    ) : (
      <>
        {recorded.length < VOICE_STYLES.length && (
          <Button
            variant="ghost"
            icon={Mic}
            onClick={() => {
              setStyle(
                VOICE_STYLES.find((item) => !recorded.includes(item)) ?? style,
              );
              setStep("record");
            }}
          >
            {t("voices:recordAnotherStyle")}
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          {t("voices:done")}
        </Button>
      </>
    );

  return (
    <Modal
      title={t("voices:cloneYourVoice")}
      width="lg"
      onClose={() => {
        if (!active && !saving) onClose();
      }}
      footer={footer}
    >
      {step === "consent" && (
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-5 text-fg-muted">{t("voices:intro")}</p>
          <div className="flex gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-warn"
              aria-hidden
            />
            <p className="text-xs leading-5 text-fg-muted">
              {t("voices:onlyYourVoice")}
            </p>
          </div>
          <Field
            label={t("voices:yourName")}
            hint={t("voices:yourNameHint")}
            error={
              speaker.trim() && !nameCheck.success
                ? t("voices:nameInvalid")
                : undefined
            }
          >
            {(id) => (
              <input
                id={id}
                className="control"
                value={speaker}
                maxLength={60}
                autoComplete="name"
                onChange={(event) => setSpeaker(event.target.value)}
              />
            )}
          </Field>
          <label className="flex items-start gap-2.5 text-xs leading-5 text-fg">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-accent"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            {t("voices:consentCheckbox")}
          </label>
        </div>
      )}

      {step === "record" && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-ui text-fg">
              {t("voices:chooseStyle")}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {VOICE_STYLES.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={active || saving}
                  aria-pressed={style === item}
                  onClick={() => setStyle(item)}
                  className={cx(
                    "rounded-lg border p-2 text-left transition-colors disabled:opacity-60",
                    style === item
                      ? "border-accent bg-accent/10"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
                    {t(STYLE_LABELS[item])}
                    {recorded.includes(item) && (
                      <Check className="size-3 text-ok" aria-hidden />
                    )}
                  </div>
                  <div className="text-2xs leading-4 text-fg-dim">
                    {t(STYLE_HINTS[item])}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-canvas p-3">
            <div className="eyebrow mb-1.5">{t("voices:readThis")}</div>
            <p
              lang="en"
              data-selectable
              className="text-[15px] leading-7 text-fg"
            >
              <mark className="rounded bg-accent/15 px-0.5 text-fg">
                {consentSentence(name)}
              </mark>{" "}
              {VOICE_CLONE_PARAGRAPH}
            </p>
            <div className="mt-1.5 text-2xs text-fg-dim">
              {t("voices:consentPart")}
            </div>
          </div>

          <details
            open
            className="rounded-lg border border-line p-3 text-xs leading-5 text-fg-muted"
          >
            <summary className="cursor-pointer text-fg">
              {t("voices:tipsTitle")}
            </summary>
            <ul className="mt-1.5 list-disc pl-4">
              <li>{t("voices:tip1")}</li>
              <li>{t("voices:tip2")}</li>
              <li>{t("voices:tip3")}</li>
              <li>{t("voices:tip4")}</li>
            </ul>
          </details>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {active ? (
                <Button variant="danger" icon={Square} onClick={stop}>
                  {t("voices:stopRecording")}
                </Button>
              ) : (
                <Button
                  variant={recording ? "secondary" : "primary"}
                  icon={recording ? RotateCcw : Mic}
                  disabled={saving}
                  onClick={() => void start()}
                >
                  {recording ? t("voices:recordAgain") : t("voices:record")}
                </Button>
              )}
              {recording && !active && (
                <Button icon={Play} disabled={saving} onClick={listen}>
                  {t("voices:listen")}
                </Button>
              )}
              <span className="ml-auto text-xs tabular-nums text-fg-muted">
                {active
                  ? t("voices:recordingTime", { time: clock(elapsed) })
                  : recording
                    ? t("voices:recordedTime", {
                        time: clock(recording.seconds),
                      })
                    : ""}
              </span>
            </div>
            <div
              role="meter"
              aria-label={t("voices:inputLevel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(meter * 100)}
              className="relative h-2 overflow-hidden rounded-full bg-line-strong"
            >
              <div
                className={cx(
                  "h-full rounded-full transition-[width] duration-75",
                  level >= 0.98
                    ? "bg-danger"
                    : meter > 0.55
                      ? "bg-ok"
                      : "bg-warn",
                )}
                style={{ width: `${Math.round(meter * 100)}%` }}
              />
            </div>
            {levelHint && (active || recording) && (
              <div className={cx("text-2xs", levelHint.tone)}>
                {levelHint.text}
              </div>
            )}
            {problem && (
              <div className="flex gap-2 text-xs leading-5 text-danger">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                {problem}
              </div>
            )}
          </div>
        </div>
      )}

      {step === "saved" && saved && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2.5 rounded-lg border border-ok/30 bg-ok/5 p-3">
            <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            <div className="text-xs leading-5 text-fg-muted">
              <div className="text-fg">
                {t("voices:savedTitle", { name: saved.name })}
              </div>
              {t("voices:savedHint")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              icon={Volume2}
              busy={preview.busyId === saved.id}
              disabled={preview.busyId !== null}
              onClick={() => preview.hear(saved.id)}
            >
              {preview.busyId === saved.id
                ? t("voices:makingSample")
                : preview.heardId === saved.id
                  ? t("voices:playAgain")
                  : t("voices:hearSample")}
            </Button>
            {preview.busyId === saved.id && (
              <span className="text-2xs text-fg-dim">
                {t("voices:sampleTakesAMinute")}
              </span>
            )}
          </div>
          {recorded.length > 0 && (
            <div className="text-2xs text-fg-dim">
              {t("voices:recordedStyles", {
                styles: recorded
                  .map((item) => t(STYLE_LABELS[item]))
                  .join(", "),
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
