/**
 * The AI Animation Director in a scene's plan: an idea in words becomes a
 * plan for one of the animations Framebop can build. The plan is shown in
 * full and every supported value can be changed before it is built; the
 * engine checks it again, then the scene's animation, sound and length are
 * made from it. Unsupported ideas are said to be so, with what exists.
 */
import {
  type AnimationBlueprint,
  type AnimationCapability,
  type ArtStyle,
  type CapabilityInfo,
  type DirectorNotice,
  type QualityFinding,
  type QualityReport,
  resolveDirection,
} from "@framebop/core";
import { Hammer, ListChecks, Sparkles, Square, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Field, Spinner } from "../components/ui";
import { bridge } from "../lib/bridge";
import { errorMessage } from "../lib/errors";
import { useBlueprint } from "../store/blueprint";
import { t } from "../i18n";
import { ArtDirectionPanel, StylePicker } from "./ArtDirection";

const BEAT_LABELS = {
  hook: "director:beatHook",
  prediction: "director:beatPrediction",
  experiment: "director:beatExperiment",
  reveal: "director:beatReveal",
  explanation: "director:beatExplanation",
  closing: "director:beatClosing",
} as const;

export function AnimationDirector({
  sceneId,
  built,
}: {
  sceneId: string;
  /** The plan the scene's animation was built from, if any. */
  built: AnimationBlueprint | null;
}) {
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const [idea, setIdea] = useState(built?.idea ?? "");
  const [draft, setDraft] = useState<AnimationBlueprint | null>(built);
  const [notices, setNotices] = useState<DirectorNotice[]>([]);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [styleChoice, setStyleChoice] = useState<ArtStyle>(
    built?.direction.style ?? "educational",
  );
  const [working, setWorking] = useState<"plan" | "check" | "apply" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    bridge
      .call("director.capabilities", {})
      .then(setCapabilities)
      .catch((reason: unknown) =>
        setError(errorMessage(reason, t("director:checkFailed"))),
      );
  }, []);

  const run = async (
    kind: "plan" | "check" | "apply",
    work: () => Promise<void>,
    fallback: string,
  ) => {
    setWorking(kind);
    setError(null);
    setDone(false);
    try {
      await work();
    } catch (reason) {
      setError(errorMessage(reason, fallback));
    } finally {
      setWorking(null);
    }
  };

  const plan = (revise: boolean) =>
    run(
      "plan",
      async () => {
        const result = await bridge.call("director.plan", {
          sceneId,
          idea: idea.trim() || (draft?.idea ?? ""),
          ...(revise && draft
            ? { previous: draft, instruction: change.trim() }
            : { style: styleChoice }),
        });
        if (result.status === "unsupported") {
          setUnsupported(result.reason);
          return;
        }
        setUnsupported(null);
        setDraft(result.blueprint);
        setNotices(result.notices);
        setQuality(result.quality);
        setChange("");
      },
      t("director:planFailed"),
    );

  const start = (capability: AnimationCapability) =>
    run(
      "check",
      async () => {
        setUnsupported(null);
        const plan = await bridge.call("director.defaults", {
          sceneId,
          capability,
        });
        const checked = await bridge.call("director.normalize", {
          blueprint: { ...plan, direction: { style: styleChoice } },
        });
        setDraft(checked.blueprint);
        setNotices(checked.notices);
        setQuality(checked.quality);
      },
      t("director:checkFailed"),
    );

  const check = (plan: AnimationBlueprint | null = draft) =>
    run(
      "check",
      async () => {
        const result = await bridge.call("director.normalize", {
          blueprint: plan,
        });
        setDraft(result.blueprint);
        setNotices(result.notices);
        setQuality(result.quality);
      },
      t("director:checkFailed"),
    );

  /** Takes a finding's suggested fix into the plan, then checks again. */
  const takeFix = (finding: QualityFinding) => {
    if (!draft || !finding.fix) return;
    const next = structuredClone(draft) as unknown as Record<string, unknown>;
    const path = finding.fix.field.split(".");
    let node = next;
    for (const key of path.slice(0, -1))
      node = node[key] as Record<string, unknown>;
    node[path.at(-1)!] = finding.fix.value;
    void check(next as unknown as AnimationBlueprint);
  };
  const blocked = quality?.status === "errors";

  // The scene's own plan is checked once on opening, to show its findings.
  useEffect(() => {
    if (built) void check(built);
    // Only on opening: later checks are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () =>
    run(
      "apply",
      async () => {
        const plan = await bridge.call("director.apply", {
          sceneId,
          blueprint: draft,
        });
        if (plan.animation?.director) setDraft(plan.animation.director);
        const episodeId = useBlueprint.getState().episodeId;
        if (episodeId) await useBlueprint.getState().load(episodeId);
        setDone(true);
      },
      t("director:applyFailed"),
    );

  const info = capabilities.find((c) => c.id === draft?.capability);
  // Only the settings the composition being built uses.
  const composition =
    draft && info?.compositions.length
      ? info.compositions.find(
          (c) =>
            c.id ===
            resolveDirection(
              draft.direction,
              info.compositions.map((x) => x.id),
            ).direction.composition,
        )
      : undefined;
  const settings = (info?.parameters ?? []).filter(
    (p) => !composition || composition.parameters.includes(p.key),
  );
  const edit = (next: Partial<AnimationBlueprint>) =>
    draft && setDraft({ ...draft, ...next });
  const text = (key: keyof AnimationBlueprint["text"], value: string) =>
    draft &&
    edit({
      text: { ...draft.text, [key]: value } as AnimationBlueprint["text"],
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Sparkles className="size-3.5 text-accent" aria-hidden />
        {t("director:title")}
      </div>
      <p className="text-2xs leading-4 text-fg-dim">{t("director:intro")}</p>
      <Field label={t("director:ideaLabel")}>
        {(id) => (
          <textarea
            id={id}
            className="control min-h-16"
            value={idea}
            placeholder={t("director:ideaPlaceholder")}
            maxLength={1000}
            onChange={(event) => setIdea(event.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <StylePicker value={styleChoice} onChange={setStyleChoice} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={Wand2}
          disabled={working !== null || idea.trim().length < 3}
          onClick={() => void plan(false)}
        >
          {working === "plan" ? t("director:planning") : t("director:plan")}
        </Button>
        {working === "plan" && (
          <Button
            size="sm"
            icon={Square}
            onClick={() => void bridge.call("director.cancel", {})}
          >
            {t("director:stop")}
          </Button>
        )}
        <span className="text-2xs text-fg-dim">{t("director:orStart")}</span>
        {capabilities.map((c) => (
          <Button
            key={c.id}
            size="sm"
            disabled={working !== null}
            title={c.summary}
            onClick={() => void start(c.id)}
          >
            {c.name}
          </Button>
        ))}
        {working && <Spinner />}
      </div>

      {error && <p className="text-2xs leading-4 text-danger">{error}</p>}
      {unsupported && (
        <div className="rounded border border-warn/40 p-2 text-2xs leading-4">
          <p className="font-semibold text-warn">{t("director:unsupported")}</p>
          <p className="text-fg-dim">{unsupported}</p>
          <p className="mt-1 text-fg-dim">{t("director:canBuild")}</p>
          <ul className="list-disc pl-4 text-fg-dim">
            {capabilities.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
        </div>
      )}

      {draft && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{info?.name ?? draft.capability}</Badge>
            <span className="text-xs font-semibold">{draft.concept.title}</span>
          </div>
          <p className="text-2xs leading-4 text-fg-dim">
            {draft.concept.objective}
          </p>

          <div className="grid grid-cols-2 gap-2">
            {(["hook", "prediction", "explanation", "closing"] as const).map(
              (key) => (
                <Field key={key} label={t(`director:${key}`)}>
                  {(id) => (
                    <input
                      id={id}
                      className="control"
                      value={draft.text[key]}
                      maxLength={48}
                      onChange={(event) => text(key, event.target.value)}
                    />
                  )}
                </Field>
              ),
            )}
            {[0, 1].map((i) => (
              <Field
                key={i}
                label={i === 0 ? t("director:labelA") : t("director:labelB")}
              >
                {(id) => (
                  <input
                    id={id}
                    className="control"
                    value={draft.text.labels[i]}
                    maxLength={20}
                    onChange={(event) => {
                      const labels = [...draft.text.labels] as [string, string];
                      labels[i] = event.target.value;
                      edit({ text: { ...draft.text, labels } });
                    }}
                  />
                )}
              </Field>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-2xs font-semibold text-fg-dim">
              {t("director:scenes")}
            </span>
            {draft.scenes.map((scene, i) => {
              const rule = info?.beats.find((b) => b.beat === scene.beat);
              return (
                <div
                  key={scene.beat}
                  className="flex items-center gap-2 text-2xs"
                >
                  <span className="w-24 shrink-0">
                    {t(BEAT_LABELS[scene.beat])}
                  </span>
                  <input
                    type="number"
                    className="control w-20"
                    aria-label={t(BEAT_LABELS[scene.beat])}
                    value={scene.seconds}
                    min={rule?.min}
                    max={rule?.max}
                    step={0.1}
                    disabled={rule?.fixed}
                    onChange={(event) => {
                      const scenes = draft.scenes.slice();
                      scenes[i] = {
                        ...scene,
                        seconds: Number(event.target.value),
                      };
                      edit({ scenes });
                    }}
                  />
                  <span className="text-fg-dim">
                    {rule?.fixed
                      ? t("director:fixedLength")
                      : t("director:seconds")}
                  </span>
                  <span className="truncate text-fg-dim">{scene.note}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-2xs font-semibold text-fg-dim">
              {t("director:parameters")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {settings.map((p) => (
                <Field
                  key={p.key}
                  label={`${p.label}${p.unit ? ` (${p.unit})` : ""}`}
                  hint={p.description}
                >
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      className="control"
                      value={draft.parameters[p.key] ?? p.default}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      onChange={(event) =>
                        edit({
                          parameters: {
                            ...draft.parameters,
                            [p.key]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {(["primary", "secondary"] as const).map((key) => (
              <Field
                key={key}
                label={
                  key === "primary"
                    ? t("director:primary")
                    : t("director:secondary")
                }
              >
                {(id) => (
                  <input
                    id={id}
                    type="color"
                    className="h-8 w-14 rounded"
                    value={draft.style[key]}
                    onChange={(event) =>
                      edit({
                        style: {
                          ...draft.style,
                          [key]: event.target.value.toUpperCase(),
                        },
                      })
                    }
                  />
                )}
              </Field>
            ))}
            <Field label={t("director:camera")}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={draft.camera}
                  onChange={(event) =>
                    edit({ camera: event.target.value as "still" | "gentle" })
                  }
                >
                  <option value="gentle">{t("director:cameraGentle")}</option>
                  <option value="still">{t("director:cameraStill")}</option>
                </select>
              )}
            </Field>
          </div>

          <ArtDirectionPanel
            draft={draft}
            info={info}
            onChange={(direction) => edit({ direction })}
          />

          {draft.assumptions.length > 0 && (
            <p className="text-2xs leading-4 text-fg-dim">
              {t("director:assumes")} {draft.assumptions.join(" · ")}
            </p>
          )}
          {notices.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-2xs leading-4">
              {notices.map((notice, i) => (
                <li
                  key={i}
                  className={
                    notice.severity === "warning" ? "text-warn" : "text-fg-dim"
                  }
                >
                  {notice.message}
                </li>
              ))}
            </ul>
          )}

          {quality && (
            <QualityReview
              quality={quality}
              onFix={takeFix}
              busy={working !== null}
              onRecheck={() => void check()}
            />
          )}

          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("director:reviseLabel")}>
              {(id) => (
                <input
                  id={id}
                  className="control min-w-64"
                  value={change}
                  maxLength={500}
                  placeholder={t("director:revisePlaceholder")}
                  onChange={(event) => setChange(event.target.value)}
                />
              )}
            </Field>
            <Button
              size="sm"
              icon={Wand2}
              disabled={working !== null || change.trim().length < 3}
              onClick={() => void plan(true)}
            >
              {t("director:revise")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={ListChecks}
              disabled={working !== null}
              onClick={() => void check()}
            >
              {t("director:check")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Hammer}
              disabled={working !== null || blocked}
              title={blocked ? t("director:blocked") : undefined}
              onClick={() => void apply()}
            >
              {t("director:apply")}
            </Button>
            {done && (
              <span className="text-2xs text-ok">{t("director:applied")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The plan's quality findings: what is wrong, how to fix it, and what ran. */
function QualityReview({
  quality,
  onFix,
  onRecheck,
  busy,
}: {
  quality: QualityReport;
  onFix: (finding: QualityFinding) => void;
  onRecheck: () => void;
  busy: boolean;
}) {
  const errors = quality.findings.filter(
    (f) => f.severity === "error" && !f.fix?.applied,
  );
  const warnings = quality.findings.filter(
    (f) => f.severity === "warning" && !f.fix?.applied,
  );
  const fixed = quality.findings.filter((f) => f.fix?.applied);
  const tone =
    quality.status === "errors"
      ? "text-danger"
      : quality.status === "warnings"
        ? "text-warn"
        : "text-ok";
  return (
    <div className="flex flex-col gap-1.5 rounded border border-line p-2 text-2xs leading-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t("director:quality")}</span>
        <span className={tone}>
          {quality.status === "errors"
            ? t("director:qualityErrors", {
                errors: errors.length,
                warnings: warnings.length,
              })
            : quality.status === "warnings"
              ? t("director:qualityWarnings", {
                  warnings: warnings.length + fixed.length,
                })
              : t("director:qualityPass")}
        </span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRecheck}>
          {t("director:revalidate")}
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {[...errors, ...warnings, ...fixed].map((finding) => (
          <li key={finding.id} className="flex flex-col gap-0.5">
            <span
              className={
                finding.fix?.applied
                  ? "text-fg-dim"
                  : finding.severity === "error"
                    ? "text-danger"
                    : "text-warn"
              }
            >
              {finding.fix?.applied ? `${t("director:fixed")} ` : ""}
              {finding.message}
            </span>
            {finding.suggestion && !finding.fix?.applied && (
              <span className="text-fg-dim">{finding.suggestion}</span>
            )}
            {finding.fix && !finding.fix.applied && (
              <span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onFix(finding)}
                >
                  {t("director:applyFix")}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <span className="text-fg-dim">
        {t("director:checksRan", { checks: quality.checks.join(", ") })}
      </span>
    </div>
  );
}
