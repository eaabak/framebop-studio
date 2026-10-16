import {
  type AnalysisItem,
  type AnalysisSection,
  type LocalModelOption,
  type ReferenceVideoDetail,
  type ResearchAnalysis,
} from "@framebop/core";
import {
  BookOpen,
  Bot,
  Cpu,
  FlaskConical,
  Lightbulb,
  Play,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  ProgressBar,
  cx,
} from "../../components/ui";
import { confirm, openPanel } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { useStudio } from "../../store/studio";
import { DetailBlock } from "../models/shared";
import { SourceBadge, formatDate } from "./shared";
import { currentLanguage, formatBytes, t } from "../../i18n";

const ACTIVE = new Set(["queued", "loading-model", "analyzing", "validating"]);

const STATUS_TEXT: Record<ResearchAnalysis["status"], string> = {
  get queued() {
    return t("research:waitingInTheQueue");
  },
  get "loading-model"() {
    return t("research:loadingTheModel");
  },
  get analyzing() {
    return t("research:analyzing");
  },
  get validating() {
    return t("research:validating");
  },
  get completed() {
    return t("research:completed");
  },
  get failed() {
    return t("research:failed");
  },
  get cancelled() {
    return t("research:cancelled");
  },
  get interrupted() {
    return t("research:interrupted");
  },
};

const KIND_TEXT: Record<AnalysisItem["kind"], string> = {
  get observation() {
    return t("research:observation");
  },
  get interpretation() {
    return t("research:interpretation");
  },
  get hypothesis() {
    return t("research:hypothesisUnverified");
  },
  get concept() {
    return t("research:concept");
  },
};

const EVIDENCE_TEXT = {
  get "metadata-snapshot"() {
    return t("research:videoDetails");
  },
  get "comment-sample"() {
    return t("research:comments2");
  },
  get comment() {
    return t("research:comment");
  },
  get transcript() {
    return t("research:transcript");
  },
  get "transcript-segment"() {
    return t("research:transcriptLine");
  },
} as const;

function usable(model: LocalModelOption): boolean {
  return (
    model.installation === "installed" || model.installation === "external"
  );
}

/** Why an analysis cannot start now, or null. */
function blocker(
  runtimeReason: string | null,
  model: LocalModelOption | undefined,
): string | null {
  if (runtimeReason) return runtimeReason;
  if (!model) return t("research:downloadALanguageModelInAi");
  if (!usable(model))
    return t("research:modelNotOnComputer", { name: model.name });
  if (!model.compatibility.ok) return model.compatibility.reason;
  return null;
}

function ModelReadiness() {
  const llm = useResearch((state) => state.llm);
  const llmError = useResearch((state) => state.llmError);
  const modelId = useResearch((state) => state.modelId);
  const chooseModel = useResearch((state) => state.chooseModel);
  const testModel = useResearch((state) => state.testModel);
  const testing = useResearch((state) => state.busy.test ?? false);
  const testResult = useResearch((state) => state.testResult);
  const setTab = useStudio((state) => state.setTab);
  if (llmError) return <p className="text-xs text-danger">{llmError}</p>;
  if (!llm) return null;
  const model = llm.models.find((item) => item.modelId === modelId);

  return (
    <DetailBlock title={t("research:localLanguageModel")}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("research:languageModel")}
          className="control w-auto min-w-64"
          value={modelId ?? ""}
          onChange={(event) => chooseModel(event.target.value)}
        >
          {llm.models.length === 0 && (
            <option value="">
              {t("research:noLanguageModelsInTheCatalog")}
            </option>
          )}
          {llm.models.map((item) => (
            <option key={item.modelId} value={item.modelId}>
              {item.name}
              {usable(item) ? "" : t("research:notDownloaded")}
            </option>
          ))}
        </select>
        {model && !usable(model) && (
          <Button size="sm" onClick={() => setTab("models")}>
            {t("research:openAiModels")}
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 text-xs">
        <li className="flex gap-2">
          <Cpu className="mt-0.5 size-3.5 shrink-0 text-fg-dim" aria-hidden />
          <span
            className={llm.runtime.available ? "text-fg-muted" : "text-warn"}
          >
            {llm.runtime.available ? (
              <>
                {t("research:runtimeRunsOnThisComputerOnly", {
                  version: llm.runtime.version,
                })}
              </>
            ) : (
              <>
                {llm.runtime.reason}{" "}
                <button
                  type="button"
                  className="text-accent hover:text-accent-strong"
                  onClick={() => openPanel("settings")}
                >
                  {t("research:openSettings")}
                </button>
              </>
            )}
          </span>
        </li>
        {model && (
          <li className="flex gap-2">
            <Bot className="mt-0.5 size-3.5 shrink-0 text-fg-dim" aria-hidden />
            <span className="text-fg-muted">
              {model.quantization ?? t("research:unquantized")} ·{" "}
              {formatBytes(model.sizeBytes)} · {model.provider} ·{" "}
              {model.license} ·{" "}
              {model.installation === "external"
                ? t("research:foundInAFolderYouAdded")
                : model.installation === "installed"
                  ? t("research:installed")
                  : model.installation === "downloading"
                    ? t("research:downloading")
                    : t("research:notDownloaded2")}
              {model.file && (
                <>
                  {" "}
                  {t("research:layersContextOf", {
                    architecture: model.file.architecture,
                    layers: model.file.layers,
                    toLocaleString:
                      model.contextTokens.toLocaleString(currentLanguage()),
                  })}{" "}
                  {model.file.trainedContextTokens?.toLocaleString(
                    currentLanguage(),
                  ) ?? "?"}{" "}
                  {t("research:tokens")}
                </>
              )}
              {usable(model) && !model.compatibility.ok && (
                <span className="text-danger">
                  {" "}
                  · {model.compatibility.reason}
                </span>
              )}
              {model.estimatedMemoryBytes !== null &&
                llm.budgetBytes !== null && (
                  <>
                    {" "}
                    {t("research:needsAboutEstimatedFromTheFile", {
                      estimatedMemoryBytes: formatBytes(
                        model.estimatedMemoryBytes,
                      ),
                      budgetBytes: formatBytes(llm.budgetBytes),
                    })}
                  </>
                )}
            </span>
          </li>
        )}
        {model && usable(model) && (
          <li className="flex items-start gap-2">
            <FlaskConical
              className="mt-0.5 size-3.5 shrink-0 text-fg-dim"
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-fg-muted">
              {testResult ? (
                <span className={testResult.ok ? "text-ok" : "text-danger"}>
                  {testResult.detail}
                </span>
              ) : model.inferenceCheck ? (
                <span
                  className={
                    model.inferenceCheck.ok ? "text-ok" : "text-danger"
                  }
                >
                  {model.inferenceCheck.ok
                    ? t("research:works")
                    : t("research:failed")}{" "}
                  {t("research:withThisRuntime", {
                    checkedAt: formatDate(model.inferenceCheck.checkedAt),
                    detail: model.inferenceCheck.detail,
                  })}
                </span>
              ) : (
                t("research:notYetRunOnThisComputer")
              )}
            </span>
            {llm.runtime.available && (
              <Button
                size="sm"
                icon={FlaskConical}
                busy={testing}
                onClick={() => void testModel()}
              >
                {t("research:testTheModel")}
              </Button>
            )}
          </li>
        )}
      </ul>
    </DetailBlock>
  );
}

function Evidence({ item }: { item: AnalysisItem }) {
  const [open, setOpen] = useState(false);
  if (item.evidence.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-2xs text-accent hover:text-accent-strong"
      >
        {open ? t("research:hide") : t("research:show")}{" "}
        {t("research:evidence2", { item: item.evidence.length })}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {item.evidence.map((evidence, index) => (
            <li
              key={`${evidence.targetId}-${index}`}
              className="rounded-md border border-line bg-canvas p-2"
            >
              <p className="text-2xs text-fg-dim">
                {EVIDENCE_TEXT[evidence.kind]}
                {evidence.locator && ` · ${evidence.locator}`} ·{" "}
                <SourceBadge source={evidence.source} />{" "}
                {formatDate(evidence.retrievedAt)}
              </p>
              {evidence.excerpt && (
                <p
                  data-selectable
                  className="mt-0.5 text-xs leading-5 text-fg-muted"
                >
                  {evidence.excerpt}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function detailText(value: AnalysisItem["details"][string]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function ItemCard({
  item,
  analysisId,
}: {
  item: AnalysisItem;
  analysisId: string;
}) {
  const developConcept = useResearch((state) => state.developConcept);
  const concept = item.kind === "concept";
  const details = Object.entries(item.details).filter(
    ([key]) => !(concept && key === "premise"),
  );
  const labels: Record<string, string> = {
    angle: t("research:uniqueAngle"),
    audience: t("research:targetAudience"),
    durationMinutes: t("research:suggestedDurationMinutes"),
    visualDirection: t("research:visualDirection"),
    researchNeeded: t("research:researchStillRequired"),
    role: t("research:role"),
    signal: t("research:signal"),
    languages: t("research:languages"),
  };
  return (
    <article
      className={cx(
        "flex flex-col gap-1.5 rounded-lg border bg-surface p-3",
        concept ? "border-accent/25" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {concept && <Lightbulb className="size-3.5 text-accent" aria-hidden />}
        <h4 className="text-ui font-medium text-fg">{item.title}</h4>
        <Badge
          tone={
            item.kind === "hypothesis"
              ? "warn"
              : item.kind === "observation"
                ? "ok"
                : item.kind === "concept"
                  ? "accent"
                  : "neutral"
          }
        >
          {KIND_TEXT[item.kind]}
        </Badge>
        <Badge>
          {item.source === "rules"
            ? t("research:measuredByFramebop")
            : `${item.confidence} confidence`}
        </Badge>
      </div>
      <p data-selectable className="text-xs leading-5 text-fg">
        {item.statement}
      </p>
      {details.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
          {details.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-fg-dim">{labels[key] ?? key}</dt>
              <dd data-selectable className="text-fg-muted">
                {detailText(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Evidence item={item} />
      {concept && (
        <Button
          size="sm"
          icon={BookOpen}
          className="self-start"
          onClick={() => void developConcept(analysisId, item.id)}
        >
          {t("research:developStory")}
        </Button>
      )}
    </article>
  );
}

function Section({
  section,
  label,
  analysisId,
}: {
  analysisId: string;
  section: AnalysisSection;
  label: string;
}) {
  const [showRejected, setShowRejected] = useState(false);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-fg">{label}</h3>
        <Badge
          tone={
            section.status === "completed"
              ? "ok"
              : section.status === "failed"
                ? "danger"
                : "neutral"
          }
        >
          {section.status === "completed"
            ? t("research:done")
            : section.status === "failed"
              ? t("research:failed")
              : t("research:skipped")}
        </Badge>
        <span className="text-2xs text-fg-dim">
          {section.input}
          {section.durationMs !== null &&
            ` · ${(section.durationMs / 1000).toFixed(1)} s`}
          {section.completionTokens !== null &&
            t("research:tokensWritten", {
              completionTokens: section.completionTokens,
            })}
        </span>
      </div>
      {section.reason && (
        <p
          className={cx(
            "text-xs leading-5",
            section.status === "failed" ? "text-danger" : "text-fg-muted",
          )}
        >
          {section.reason}
        </p>
      )}
      {section.items.map((item) => (
        <ItemCard key={item.id} item={item} analysisId={analysisId} />
      ))}
      {section.rejected.length > 0 && (
        <div className="text-2xs text-fg-dim">
          <button
            type="button"
            className="text-accent hover:text-accent-strong"
            onClick={() => setShowRejected((value) => !value)}
          >
            {showRejected
              ? t("research:hideRejected", { count: section.rejected.length })
              : t("research:showRejected", { count: section.rejected.length })}
          </button>
          {showRejected && (
            <ul className="mt-1 flex flex-col gap-1">
              {section.rejected.map((entry, index) => (
                <li key={`${entry.title}-${index}`}>
                  <span className="text-fg-muted">{entry.title}:</span>{" "}
                  {entry.problems.join(" ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function AnalysisPanel({ detail }: { detail: ReferenceVideoDetail }) {
  const llm = useResearch((state) => state.llm);
  const analyses = useResearch((state) => state.analyses);
  const modelId = useResearch((state) => state.modelId);
  const capabilities = useResearch((state) => state.capabilities);
  const refreshLlm = useResearch((state) => state.refreshLlm);
  const loadAnalyses = useResearch((state) => state.loadAnalyses);
  const startAnalysis = useResearch((state) => state.startAnalysis);
  const cancelAnalysis = useResearch((state) => state.cancelAnalysis);
  const deleteAnalysis = useResearch((state) => state.deleteAnalysis);
  const starting = useResearch((state) => state.busy.analysis ?? false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    analyses.find((item) => item.id === selectedId) ?? analyses[0] ?? null;
  const job = useStudio((state) =>
    selected?.jobId
      ? state.jobs.find((item) => item.id === selected.jobId)
      : undefined,
  );

  useEffect(() => {
    void refreshLlm();
    void loadAnalyses();
  }, [refreshLlm, loadAnalyses, detail.video.id]);

  // The job's own updates drive the view: reload when its step or state changes.
  const jobStep = job ? `${job.status}:${job.progressMessage ?? ""}` : "";
  useEffect(() => {
    if (jobStep) void loadAnalyses();
    if (job && !["pending", "running"].includes(job.status)) void refreshLlm();
  }, [jobStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = llm?.models.find((item) => item.modelId === modelId);
  const reason = llm
    ? blocker(
        llm.runtime.available
          ? null
          : (llm.runtime.reason ?? t("research:theRuntimeIsNotSetUp")),
        model,
      )
    : null;
  const running = selected && ACTIVE.has(selected.status);
  const label = (task: AnalysisSection["task"]) =>
    capabilities.find((item) => item.task === task)?.label ?? task;

  return (
    <div className="flex flex-col gap-4">
      <ModelReadiness />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={Play}
          busy={starting}
          disabled={reason !== null || Boolean(running)}
          onClick={async () => {
            const id = await startAnalysis();
            if (id) setSelectedId(id);
          }}
        >
          {t("research:startAnalysis")}
        </Button>
        {running && selected && (
          <Button
            icon={Square}
            onClick={() => void cancelAnalysis(selected.id)}
          >
            {t("research:cancelAnalysis")}
          </Button>
        )}
        <p className="min-w-0 flex-1 text-2xs leading-4 text-fg-dim">
          {reason ?? t("research:sixAnalysesRunOneAfterAnother")}
        </p>
      </div>

      {running && selected && (
        <div
          className="flex flex-col gap-1.5 card-surface rounded-xl border p-3"
          role="status"
        >
          <p className="text-xs text-fg">
            {STATUS_TEXT[selected.status]}
            {job?.progressMessage && selected.status === "analyzing"
              ? `: ${job.progressMessage}`
              : ""}
          </p>
          <ProgressBar value={job?.progress ?? null} />
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="card-surface rounded-xl border">
          <EmptyState
            icon={Bot}
            title={t("research:noAnalysesYet")}
            description={t("research:anAnalysisReadsTheDetailsComments")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-fg-dim">
              {t("research:history")}
            </span>
            {analyses.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cx(
                  "rounded-md border px-2 py-1 text-2xs transition-colors",
                  item.id === selected?.id
                    ? "border-accent/50 bg-accent/10 text-fg"
                    : "border-line text-fg-muted hover:text-fg",
                )}
              >
                {formatDate(item.createdAt)} · {STATUS_TEXT[item.status]}
                {item.stale && t("research:stale")}
              </button>
            ))}
          </div>
          {selected && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-2xs leading-4 text-fg-dim">
                  {selected.modelName} ·{" "}
                  {selected.runtime ?? t("research:runtimeNotRecorded")}{" "}
                  {t("research:contextTokensTemperature", {
                    toLocaleString:
                      selected.config.contextTokens.toLocaleString(
                        currentLanguage(),
                      ),
                    temperature: selected.config.temperature,
                  })}
                  {selected.finishedAt &&
                    t("research:finished", {
                      finishedAt: formatDate(selected.finishedAt),
                    })}
                </p>
                {!ACTIVE.has(selected.status) && (
                  <IconButton
                    tone="danger"
                    label={t("research:deleteThisAnalysis")}
                    icon={Trash2}
                    size="sm"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: t("research:deleteThisAnalysis2"),
                          message: t(
                            "research:itsResultsAreRemovedTheResearch",
                          ),
                          confirmLabel: t("research:deleteAnalysis"),
                          tone: "danger",
                        })
                      ) {
                        await deleteAnalysis(selected.id);
                        setSelectedId(null);
                      }
                    }}
                  />
                )}
              </div>
              {selected.stale && (
                <p className="flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/5 p-2 text-xs text-warn">
                  <TriangleAlert
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                  {t("research:theResearchDataChangedAfterThis")}
                </p>
              )}
              {selected.error && (
                <p className="text-xs text-danger">{selected.error}</p>
              )}
              {selected.sections.map((section) => (
                <Section
                  key={section.task}
                  section={section}
                  label={label(section.task)}
                  analysisId={selected.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
