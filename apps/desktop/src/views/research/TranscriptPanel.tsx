import {
  RIGHTS_BASES,
  RIGHTS_BASIS_LABELS,
  type ReferenceVideoDetail,
  type RightsBasis,
  TRANSCRIPT_MAX_BYTES,
  type TranscriptDetail,
  type TranscriptFormat,
  formatClock,
} from "@framebop/core";
import {
  Bookmark,
  BookmarkCheck,
  FileText,
  FileUp,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Spinner,
  cx,
} from "../../components/ui";
import { EngineError, bridge } from "../../lib/bridge";
import { confirm } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { Provenance, formatNumber } from "./shared";
import { t } from "../../i18n";

const FORMAT_LABELS: Record<TranscriptFormat, string> = {
  get webvtt() {
    return t("research:webvtt");
  },
  get srt() {
    return t("research:subripSrt");
  },
  get text() {
    return t("research:plainText");
  },
};

export function ImportTranscriptDialog({
  onClose,
  onImported,
}: {
  onClose(): void;
  onImported(id: string): void;
}) {
  const importTranscript = useResearch((state) => state.importTranscript);
  const busy = useResearch((state) => state.busy.transcript ?? false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [pasted, setPasted] = useState("");
  const [format, setFormat] = useState<TranscriptFormat | "auto">("auto");
  const [language, setLanguage] = useState("");
  const [rightsBasis, setRightsBasis] = useState<RightsBasis | null>(null);
  const [rightsNote, setRightsNote] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(chosen: File | undefined) {
    setError(null);
    if (!chosen) return;
    if (chosen.size > TRANSCRIPT_MAX_BYTES) {
      setFile(null);
      return setError(t("research:theFileIsLargerThan5"));
    }
    setFile({ name: chosen.name, content: await chosen.text() });
  }

  const content = mode === "file" ? (file?.content ?? "") : pasted;
  const ready = content.trim() !== "" && rightsBasis !== null && authorized;

  async function submit() {
    if (!ready || !rightsBasis) return;
    setError(null);
    try {
      const id = await importTranscript({
        fileName:
          mode === "file"
            ? (file?.name ?? "transcript.txt")
            : t("research:pastedText"),
        content,
        format: format === "auto" ? null : format,
        language: language.trim() || null,
        rightsBasis,
        rightsNote: rightsNote.trim(),
        authorized: true,
      });
      if (id) onImported(id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("research:theTranscriptCouldNotBeImported"),
      );
    }
  }

  return (
    <Modal
      title={t("research:importATranscript")}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("research:cancel")}
          </Button>
          <Button
            variant="primary"
            icon={FileUp}
            busy={busy}
            disabled={!ready}
            onClick={() => void submit()}
          >
            {t("research:import")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-5 text-fg-muted">
          {t("research:framebopDoesNotDownloadCaptionsFrom")}
        </p>

        <div
          role="tablist"
          aria-label={t("research:transcriptSource")}
          className="flex self-start rounded-md border border-line bg-canvas p-0.5"
        >
          {(
            [
              ["file", t("research:chooseAFile")],
              ["paste", t("research:pasteText")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cx(
                "h-7 rounded px-3 text-xs font-medium transition-colors",
                mode === value
                  ? "bg-overlay text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <div className="flex items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".vtt,.srt,.txt,text/vtt,text/plain,application/x-subrip"
              className="hidden"
              onChange={(event) => void pick(event.target.files?.[0])}
            />
            <Button icon={FileUp} onClick={() => fileInput.current?.click()}>
              {t("research:chooseFile")}
            </Button>
            <span className="truncate text-xs text-fg-muted">
              {file
                ? t("research:characters", {
                    name: file.name,
                    file: formatNumber(file.content.length),
                  })
                : t("research:noFileChosen")}
            </span>
          </div>
        ) : (
          <textarea
            aria-label={t("research:transcriptText")}
            rows={6}
            className="control resize-y font-mono text-2xs"
            placeholder={t("research:n000WelcomeBack004")}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("research:format")}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as TranscriptFormat | "auto")
                }
              >
                <option value="auto">
                  {t("research:recogniseAutomatically")}
                </option>
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={t("research:language")}
            hint={t("research:optionalACodeSuchAsEn")}
          >
            {(id) => (
              <input
                id={id}
                className="control"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-fg-muted">
            {t("research:whyYouMayUseIt")}
          </legend>
          {RIGHTS_BASES.map((basis) => (
            <label
              key={basis}
              className="flex items-center gap-2 text-xs text-fg"
            >
              <input
                type="radio"
                name="rights-basis"
                checked={rightsBasis === basis}
                onChange={() => setRightsBasis(basis)}
              />
              {RIGHTS_BASIS_LABELS[basis]}
            </label>
          ))}
        </fieldset>
        <Field
          label={t("research:details")}
          hint={t("research:optionalTheLicenceSNameOr")}
        >
          {(id) => (
            <input
              id={id}
              className="control"
              value={rightsNote}
              onChange={(event) => setRightsNote(event.target.value)}
            />
          )}
        </Field>
        <label className="flex items-start gap-2 rounded-md border border-line bg-canvas p-2.5 text-xs leading-5 text-fg">
          <input
            type="checkbox"
            className="mt-1"
            checked={authorized}
            onChange={(event) => setAuthorized(event.target.checked)}
          />
          {t("research:iConfirmThatIMayUse")}
        </label>
        {error && (
          <p role="alert" data-selectable className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

const SHOWN = 300;

function TranscriptView({
  id,
  detail,
}: {
  id: string;
  detail: ReferenceVideoDetail;
}) {
  const deleteTranscript = useResearch((state) => state.deleteTranscript);
  const citations = useResearch((state) => state.citations);
  const toggleCitation = useResearch((state) => state.toggleCitation);
  const [data, setData] = useState<TranscriptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(SHOWN);

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    setLimit(SHOWN);
    bridge
      .call("research.transcripts.get", { id })
      .then((result) => current && setData(result))
      .catch(
        (caught: unknown) =>
          current &&
          setError(
            caught instanceof EngineError
              ? caught.message
              : t("research:theTranscriptCouldNotBeLoaded"),
          ),
      );
    return () => {
      current = false;
    };
  }, [id]);

  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  const { transcript, segments } = data;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? segments.filter((segment) => segment.text.toLowerCase().includes(needle))
    : segments;
  const timing = detail.findings.find(
    (finding) =>
      finding.kind === "transcript-structure" &&
      finding.evidence[0]?.targetId === transcript.id,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 card-surface rounded-xl border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-ui font-medium text-fg">
              {transcript.fileName}
            </p>
            <p className="text-2xs text-fg-dim">
              {t("research:wordsSegments", {
                transcript: FORMAT_LABELS[transcript.format],
                wordCount: formatNumber(transcript.wordCount),
                segmentCount: formatNumber(transcript.segmentCount),
              })}{" "}
              {transcript.hasTimestamps
                ? t("research:timedSpans", {
                    coveredSeconds: formatClock(transcript.coveredSeconds ?? 0),
                  })
                : t("research:noTimestamps")}{" "}
              ·{" "}
              {transcript.language
                ? t("research:languageDeclared", {
                    language: transcript.language,
                  })
                : t("research:languageNotDeclared")}
            </p>
          </div>
          <IconButton
            tone="danger"
            label={t("research:deleteThisTranscript")}
            icon={Trash2}
            size="sm"
            onClick={async () => {
              if (
                await confirm({
                  title: t("research:deleteThisTranscript2"),
                  message: t("research:itIsRemovedFromThisProject"),
                  confirmLabel: t("research:deleteTranscript"),
                  tone: "danger",
                })
              ) {
                await deleteTranscript(transcript.id);
              }
            }}
          />
        </div>
        <Provenance source="transcript-file" at={transcript.importedAt} />
        <p className="text-2xs text-fg-dim">
          {t("research:rights", {
            transcript: RIGHTS_BASIS_LABELS[transcript.rightsBasis],
          })}
          {transcript.rightsNote && ` (${transcript.rightsNote})`}
        </p>
        {transcript.warnings.map((warning) => (
          <p
            key={warning}
            className="flex items-start gap-1.5 text-2xs leading-4 text-warn"
          >
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}
        {timing && (
          <p className="text-xs leading-5 text-fg-muted">{timing.statement}</p>
        )}
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-dim"
          aria-hidden
        />
        <input
          aria-label={t("research:searchTheTranscript")}
          className="control pl-8"
          placeholder={t("research:searchTheTranscript")}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setLimit(SHOWN);
          }}
        />
      </div>
      {needle && (
        <p className="text-2xs text-fg-dim">
          {t("research:segmentsContain", {
            shown: formatNumber(shown.length),
            trim: filter.trim(),
          })}
        </p>
      )}
      <ol className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
        {shown.slice(0, limit).map((segment) => {
          const cited = citations.some((item) => item.targetId === segment.id);
          return (
            <li
              key={segment.id}
              className={cx("flex gap-3 px-3 py-2", cited && "bg-accent/5")}
            >
              <span className="w-14 shrink-0 pt-0.5 font-mono text-2xs text-fg-dim tabular-nums">
                {segment.startMs !== null
                  ? formatClock(segment.startMs / 1000)
                  : `#${segment.position + 1}`}
              </span>
              <p
                data-selectable
                className="min-w-0 flex-1 text-xs leading-5 text-fg"
              >
                {segment.text}
              </p>
              <IconButton
                label={
                  cited
                    ? t("research:removeFromTheEvidenceForA")
                    : t("research:useAsEvidenceForANote")
                }
                icon={cited ? BookmarkCheck : Bookmark}
                size="sm"
                active={cited}
                onClick={() =>
                  toggleCitation({
                    kind: "transcript-segment",
                    targetId: segment.id,
                    label: `${segment.startMs !== null ? `${formatClock(segment.startMs / 1000)} ` : ""}${segment.text.slice(0, 70)}`,
                  })
                }
              />
            </li>
          );
        })}
      </ol>
      {shown.length > limit && (
        <Button
          className="self-center"
          size="sm"
          onClick={() => setLimit((value) => value + SHOWN)}
        >
          {t("research:showMore2", {
            sHOWN: Math.min(SHOWN, shown.length - limit),
          })}
        </Button>
      )}
    </div>
  );
}

export function TranscriptPanel({ detail }: { detail: ReferenceVideoDetail }) {
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const transcripts = detail.transcripts;
  const active =
    transcripts.find((item) => item.id === selected) ??
    transcripts.at(-1) ??
    null;

  return (
    <div className="flex flex-col gap-3">
      {transcripts.length === 0 ? (
        <div className="card-surface rounded-xl border">
          <EmptyState
            icon={FileText}
            title={t("research:noTranscriptImported")}
            description={t("research:importATranscriptYouAreAllowed")}
            action={
              <Button
                variant="primary"
                icon={FileUp}
                onClick={() => setImporting(true)}
              >
                {t("research:importATranscript")}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {transcripts.length > 1 &&
              transcripts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className={cx(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    item.id === active?.id
                      ? "border-accent/50 bg-accent/10 text-fg"
                      : "border-line text-fg-muted hover:text-fg",
                  )}
                >
                  {item.fileName}
                  {item.language && <Badge>{item.language}</Badge>}
                </button>
              ))}
            <Button
              size="sm"
              icon={FileUp}
              className="ml-auto"
              onClick={() => setImporting(true)}
            >
              {t("research:importAnother")}
            </Button>
          </div>
          {active && <TranscriptView id={active.id} detail={detail} />}
        </>
      )}
      {importing && (
        <ImportTranscriptDialog
          onClose={() => setImporting(false)}
          onImported={(id) => {
            setImporting(false);
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}
