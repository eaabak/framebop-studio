import {
  type EvidenceKind,
  type FindingBasis,
  type ReferenceVideoDetail,
  type ResearchFinding,
} from "@framebop/core";
import {
  Bot,
  FileText,
  Info,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, Field, IconButton, cx } from "../../components/ui";
import { confirm } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { DetailBlock } from "../models/shared";
import { BasisBadge, SourceBadge, formatDate } from "./shared";
import { t } from "../../i18n";

const EVIDENCE_ICONS: Record<EvidenceKind, typeof Info> = {
  "metadata-snapshot": Table2,
  "comment-sample": MessagesSquare,
  comment: MessagesSquare,
  transcript: FileText,
  "transcript-segment": FileText,
};

const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
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
};

export function FindingCard({ finding }: { finding: ResearchFinding }) {
  const deleteNote = useResearch((state) => state.deleteNote);
  const [open, setOpen] = useState(false);
  return (
    <article className="flex flex-col gap-2 card-surface rounded-xl border p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="text-ui font-medium text-fg">{finding.title}</h4>
          <div className="flex flex-wrap items-center gap-1.5">
            <BasisBadge basis={finding.basis} />
            <SourceBadge
              source={finding.generator === "user" ? "user" : "framebop-rules"}
            />
            <span className="text-2xs text-fg-dim">
              {formatDate(finding.createdAt)}
            </span>
          </div>
        </div>
        {finding.generator === "user" && (
          <IconButton
            tone="danger"
            label={t("research:deleteThisNote")}
            icon={Trash2}
            size="sm"
            onClick={async () => {
              if (
                await confirm({
                  title: t("research:deleteThisNote2"),
                  message: t("research:theNoteAndItsListOf"),
                  confirmLabel: t("research:deleteNote"),
                  tone: "danger",
                })
              ) {
                await deleteNote(finding.id);
              }
            }}
          />
        )}
      </header>
      <p
        data-selectable
        className="text-xs leading-5 whitespace-pre-wrap text-fg"
      >
        {finding.statement}
      </p>
      <p className="text-2xs leading-4 text-fg-dim">
        <span className="font-medium text-fg-muted">{t("research:how")} </span>
        {finding.method}
      </p>
      {finding.uncertainty && (
        <p className="text-2xs leading-4 text-warn/90">
          <span className="font-medium">{t("research:limits")} </span>
          {finding.uncertainty}
        </p>
      )}
      {finding.evidence.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="text-2xs text-accent hover:text-accent-strong"
          >
            {open ? t("research:hide") : t("research:show")}{" "}
            {t("research:evidence3", { finding: finding.evidence.length })}
          </button>
          {open && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {finding.evidence.map((item) => {
                const Icon = EVIDENCE_ICONS[item.kind];
                return (
                  <li
                    key={item.id}
                    className="flex gap-2 rounded-md border border-line bg-canvas p-2"
                  >
                    <Icon
                      className="mt-0.5 size-3.5 shrink-0 text-fg-dim"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-2xs text-fg-dim">
                        {EVIDENCE_LABELS[item.kind]}
                        {item.locator && ` · ${item.locator}`} ·{" "}
                        <SourceBadge source={item.source} />{" "}
                        {formatDate(item.retrievedAt)}
                        {!item.available && (
                          <span className="ml-1 text-warn">
                            {t("research:sourceSinceRemovedFromTheProject")}
                          </span>
                        )}
                      </p>
                      {item.excerpt && (
                        <p
                          data-selectable
                          className="mt-0.5 text-xs leading-5 text-fg-muted"
                        >
                          {item.excerpt}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-2xs text-fg-dim">
          {t("research:noEvidenceAttachedThisIsYour")}
        </p>
      )}
    </article>
  );
}

/** A note of the user's, with the items they marked as evidence. */
export function NoteForm({ forVideo }: { forVideo: boolean }) {
  const citations = useResearch((state) => state.citations);
  const toggleCitation = useResearch((state) => state.toggleCitation);
  const createNote = useResearch((state) => state.createNote);
  const busy = useResearch((state) => state.busy.note ?? false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [basis, setBasis] = useState<FindingBasis>("observed");

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          await createNote({
            title: title.trim(),
            statement: statement.trim(),
            basis,
            forVideo,
          })
        ) {
          setTitle("");
          setStatement("");
        }
      }}
    >
      <Field label={t("research:title")}>
        {(id) => (
          <input
            id={id}
            className="control"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      </Field>
      <Field label={t("research:note")}>
        {(id) => (
          <textarea
            id={id}
            rows={3}
            className="control resize-y"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
          />
        )}
      </Field>
      <fieldset className="flex flex-wrap gap-4 text-xs text-fg">
        <legend className="mb-1 text-xs font-medium text-fg-muted">
          {t("research:thisNoteIs")}
        </legend>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="basis"
            checked={basis === "observed"}
            onChange={() => setBasis("observed")}
          />
          {t("research:observedSomethingTheDataShows")}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="basis"
            checked={basis === "inferred"}
            onChange={() => setBasis("inferred")}
          />
          {t("research:inferredYourInterpretation")}
        </label>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-muted">
          {t("research:evidence4", { citations: citations.length })}
        </p>
        {citations.length === 0 ? (
          <p className="text-2xs leading-4 text-fg-dim">
            {t("research:markCommentsOrTranscriptLinesWith")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {citations.map((item) => (
              <li
                key={item.targetId}
                className="flex items-center gap-2 rounded border border-line bg-canvas px-2 py-1"
              >
                <span className="text-2xs text-fg-dim">
                  {EVIDENCE_LABELS[item.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">
                  {item.label}
                </span>
                <IconButton
                  label={t("research:removeFromTheEvidence")}
                  icon={X}
                  size="sm"
                  onClick={() => toggleCitation(item)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        icon={NotebookPen}
        busy={busy}
        disabled={!title.trim() || !statement.trim()}
        className="self-start"
      >
        {t("research:saveNote")}
      </Button>
    </form>
  );
}

export function EvidencePanel({ detail }: { detail: ReferenceVideoDetail }) {
  const rules = detail.findings.filter(
    (finding) => finding.generator === "framebop-rules",
  );
  const notes = detail.findings.filter(
    (finding) => finding.generator !== "framebop-rules",
  );
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="eyebrow">
            {t("research:findingsFromTheCollectedData")}
          </h3>
          <span className="text-2xs text-fg-dim">
            {t("research:ruleBasedRecalculatedWheneverTheData")}
          </span>
        </div>
        {rules.length === 0 ? (
          <div className="card-surface rounded-xl border">
            <EmptyState
              compact
              icon={ListChecks}
              title={t("research:nothingToReportYet")}
              description={t("research:findingsAppearOnceVideoDetailsComments")}
            />
          </div>
        ) : (
          rules.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("research:yourNotesOnThisVideo")}</h3>
        {notes.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
        <div className={cx("card-surface rounded-xl border p-3")}>
          <NoteForm forVideo />
        </div>
      </section>

      <p className="text-2xs leading-4 text-fg-dim">
        {t("research:analysesByTheLocalLanguageModel")}
      </p>
    </div>
  );
}
