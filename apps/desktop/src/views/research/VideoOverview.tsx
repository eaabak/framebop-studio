import {
  type FieldNote,
  type ManualMetadata,
  METADATA_FIELD_LABELS,
  type MetadataField,
  type MetadataSnapshot,
  type ReferenceVideoDetail,
  formatClock,
} from "@framebop/core";
import { CloudDownload, PencilLine, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  Modal,
} from "../../components/ui";
import { confirm } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { DetailBlock } from "../models/shared";
import { Provenance, Value, formatDate, formatNumber } from "./shared";
import { type TranslationKey, t } from "../../i18n";

const STATE_TEXT: Record<FieldNote["state"], () => string> = {
  available: () => "",
  hidden: () => t("research:hidden"),
  "not-provided": () => t("research:notProvided"),
  "not-applicable": () => t("research:notApplicable"),
};

const LIVE_TEXT = {
  get none() {
    return t("research:notLive");
  },
  get live() {
    return t("research:liveNow");
  },
  get upcoming() {
    return t("research:scheduled");
  },
};

function topicName(url: string): string {
  const name = url.split("/wiki/")[1];
  return name ? decodeURIComponent(name).replace(/_/g, " ") : url;
}

function display(field: MetadataField, snapshot: MetadataSnapshot): ReactNode {
  const value = snapshot.metadata[field];
  if (value === null) return null;
  switch (field) {
    case "publishedAt":
    case "channelPublishedAt":
      return formatDate(value as string);
    case "durationSeconds":
      return `${formatClock(value as number)} (${formatNumber(value as number)} s)`;
    case "viewCount":
    case "likeCount":
    case "commentCount":
    case "channelSubscriberCount":
    case "channelVideoCount":
    case "channelViewCount":
      return formatNumber(value as number);
    case "captionsAvailable":
    case "madeForKids":
      return value ? t("research:yes") : t("research:no");
    case "liveBroadcastContent":
      return LIVE_TEXT[value as keyof typeof LIVE_TEXT];
    case "definition":
      return (value as string).toUpperCase();
    case "tags":
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((tag) => (
            <span
              key={tag}
              className="rounded bg-raised px-1.5 py-0.5 text-2xs text-fg-muted"
            >
              {tag}
            </span>
          ))}
        </span>
      );
    case "topicCategories":
      return (value as string[]).map(topicName).join(", ");
    case "thumbnailUrl":
      return (
        <span className="font-mono text-2xs break-all text-fg-muted">
          {value as string}
        </span>
      );
    default:
      return String(value);
  }
}

function MetadataValue({
  field,
  snapshot,
}: {
  field: MetadataField;
  snapshot: MetadataSnapshot;
}) {
  const note = snapshot.fields[field];
  const shown = display(field, snapshot);
  return (
    <Value
      label={METADATA_FIELD_LABELS[field]}
      missing={
        shown === null
          ? note
            ? STATE_TEXT[note.state]()
            : t("research:notProvided")
          : null
      }
      note={note?.note ?? null}
    >
      {shown}
    </Value>
  );
}

const GROUPS: [TranslationKey, MetadataField[]][] = [
  [
    "research:groupVideo",
    [
      "title",
      "publishedAt",
      "durationSeconds",
      "liveBroadcastContent",
      "definition",
      "captionsAvailable",
      "defaultAudioLanguage",
      "defaultLanguage",
      "madeForKids",
      "categoryId",
    ],
  ],
  ["research:groupPublicCounts", ["viewCount", "likeCount", "commentCount"]],
  [
    "research:groupChannel",
    [
      "channelTitle",
      "channelHandle",
      "channelSubscriberCount",
      "channelVideoCount",
      "channelViewCount",
      "channelCountry",
      "channelPublishedAt",
    ],
  ],
  ["research:groupTopics", ["tags", "topicCategories", "thumbnailUrl"]],
];

function parseDuration(text: string): number | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return "invalid";
  return (
    Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
}

function parseCount(text: string): number | null | "invalid" {
  const value = text.replace(/[\s,.]/g, "");
  if (value === "") return null;
  return /^\d{1,15}$/.test(value) ? Number(value) : "invalid";
}

/** Details typed in by the user, recorded as "Entered by you". */
export function ManualMetadataDialog({ onClose }: { onClose: () => void }) {
  const video = useResearch((state) => state.video);
  const save = useResearch((state) => state.saveManualMetadata);
  const busy = useResearch((state) => state.busy.manual ?? false);
  // Only earlier manual entries are offered again: values from the API must
  // not become "entered by you".
  const previous =
    video?.snapshot?.source === "manual" ? video.snapshot.metadata : null;
  const [form, setForm] = useState({
    title: previous?.title ?? "",
    channelTitle: previous?.channelTitle ?? "",
    publishedAt: previous?.publishedAt ?? "",
    duration:
      previous?.durationSeconds != null
        ? formatClock(previous.durationSeconds)
        : "",
    views: previous?.viewCount?.toString() ?? "",
    likes: previous?.likeCount?.toString() ?? "",
    comments: previous?.commentCount?.toString() ?? "",
    language: previous?.defaultAudioLanguage ?? "",
    description: previous?.description ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const update =
    (key: keyof typeof form) => (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit() {
    const duration = parseDuration(form.duration);
    const counts = [
      parseCount(form.views),
      parseCount(form.likes),
      parseCount(form.comments),
    ];
    if (duration === "invalid")
      return setError(t("research:writeTheDurationAs1234"));
    if (counts.includes("invalid"))
      return setError(t("research:countsMustBeWholeNumbers"));
    const [viewCount, likeCount, commentCount] = counts as (number | null)[];
    const values: ManualMetadata = {
      title: form.title.trim() || null,
      channelTitle: form.channelTitle.trim() || null,
      publishedAt: form.publishedAt || null,
      durationSeconds: duration,
      viewCount: viewCount ?? null,
      likeCount: likeCount ?? null,
      commentCount: commentCount ?? null,
      defaultAudioLanguage: form.language.trim() || null,
      description: form.description.trim() || null,
    };
    if (Object.values(values).every((value) => value === null)) {
      return setError(t("research:enterAtLeastOneDetail"));
    }
    setError(null);
    if (await save(values)) onClose();
  }

  return (
    <Modal
      title={t("research:enterDetailsByHand")}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("research:cancel")}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {t("research:saveDetails")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-xs leading-5 text-fg-muted">
          {t("research:copyWhatYouCanSeeOn")}
        </p>
        <Field label={t("research:title")}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={form.title}
              onChange={update("title")}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("research:channel")}>
            {(id) => (
              <input
                id={id}
                className="control"
                value={form.channelTitle}
                onChange={update("channelTitle")}
              />
            )}
          </Field>
          <Field label={t("research:published")}>
            {(id) => (
              <input
                id={id}
                type="date"
                className="control"
                value={form.publishedAt}
                onChange={update("publishedAt")}
              />
            )}
          </Field>
          <Field
            label={t("research:duration")}
            hint={t("research:n123410203Or")}
          >
            {(id) => (
              <input
                id={id}
                className="control"
                value={form.duration}
                onChange={update("duration")}
                placeholder="12:34"
              />
            )}
          </Field>
          <Field
            label={t("research:audioLanguage")}
            hint={t("research:aCodeSuchAsEnOr")}
          >
            {(id) => (
              <input
                id={id}
                className="control"
                value={form.language}
                onChange={update("language")}
              />
            )}
          </Field>
          <Field label={t("research:views")}>
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                className="control"
                value={form.views}
                onChange={update("views")}
              />
            )}
          </Field>
          <Field label={t("research:likes")}>
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                className="control"
                value={form.likes}
                onChange={update("likes")}
              />
            )}
          </Field>
          <Field label={t("research:comments2")}>
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                className="control"
                value={form.comments}
                onChange={update("comments")}
              />
            )}
          </Field>
        </div>
        <Field label={t("research:description")}>
          {(id) => (
            <textarea
              id={id}
              rows={4}
              className="control resize-y"
              value={form.description}
              onChange={update("description")}
            />
          )}
        </Field>
        {error && <p className="text-2xs text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function VideoNotes({ detail }: { detail: ReferenceVideoDetail }) {
  const save = useResearch((state) => state.updateVideoNotes);
  const [draft, setDraft] = useState(detail.video.notes);
  useEffect(() => setDraft(detail.video.notes), [detail.video.notes]);
  return (
    <DetailBlock title={t("research:yourNotesOnThisVideo")}>
      <textarea
        aria-label={t("research:yourNotesOnThisVideo")}
        rows={3}
        className="control resize-y"
        placeholder={t("research:whyThisVideoIsInThe")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== detail.video.notes) void save(draft);
        }}
      />
    </DetailBlock>
  );
}

export function VideoOverview({
  detail,
  onEnterManually,
}: {
  detail: ReferenceVideoDetail;
  onEnterManually: () => void;
}) {
  const fetchMetadata = useResearch((state) => state.fetchMetadata);
  const deleteSnapshot = useResearch((state) => state.deleteSnapshot);
  const busy = useResearch((state) => state.busy.metadata ?? false);
  const keyConfigured = useResearch(
    (state) => state.keyStatus?.configured ?? false,
  );
  const [showDescription, setShowDescription] = useState(false);
  const snapshot = detail.snapshot;

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-4">
        <div className="card-surface rounded-xl border">
          <EmptyState
            icon={CloudDownload}
            title={t("research:noDetailsCollectedYet")}
            description={
              keyConfigured
                ? t("research:fetchTheTitleDurationPublicCounts")
                : t("research:addAYoutubeDataApiKey")
            }
            action={
              <>
                {keyConfigured && (
                  <Button
                    variant="primary"
                    icon={CloudDownload}
                    busy={busy}
                    onClick={() => void fetchMetadata()}
                  >
                    {t("research:fetchFromYoutube")}
                  </Button>
                )}
                <Button icon={PencilLine} onClick={onEnterManually}>
                  {t("research:enterByHand")}
                </Button>
              </>
            }
          />
        </div>
        <VideoNotes detail={detail} />
      </div>
    );
  }

  const description = snapshot.metadata.description;
  return (
    <div className="flex flex-col gap-4">
      <Provenance
        source={snapshot.source}
        at={snapshot.retrievedAt}
        extra={
          snapshot.quotaUnits > 0 && (
            <span>
              · {t("common:quotaUnits", { count: snapshot.quotaUnits })}
            </span>
          )
        }
      />
      {GROUPS.map(([title, fields]) => (
        <DetailBlock key={title} title={t(title)}>
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-4 gap-y-3">
            {fields.map((field) => (
              <MetadataValue key={field} field={field} snapshot={snapshot} />
            ))}
          </dl>
        </DetailBlock>
      ))}
      <DetailBlock
        title={t("research:description")}
        aside={
          description && description.length > 400 ? (
            <button
              type="button"
              className="text-2xs text-fg-dim hover:text-accent"
              onClick={() => setShowDescription((value) => !value)}
            >
              {showDescription ? t("research:showLess") : t("research:showAll")}
            </button>
          ) : undefined
        }
      >
        {description ? (
          <p
            data-selectable
            className="text-xs leading-5 whitespace-pre-wrap text-fg-muted"
          >
            {showDescription || description.length <= 400
              ? description
              : `${description.slice(0, 400)}…`}
          </p>
        ) : (
          <p className="text-xs text-fg-dim italic">
            {snapshot.fields.description?.note ?? t("research:notProvided")}
          </p>
        )}
      </DetailBlock>
      <VideoNotes detail={detail} />
      <DetailBlock
        title={t("research:snapshots", { detail: detail.snapshots.length })}
      >
        <p className="text-2xs leading-4 text-fg-dim">
          {t("research:eachFetchOrManualEntryIs")}
        </p>
        <ul className="flex flex-col divide-y divide-line">
          {detail.snapshots.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-1.5"
            >
              <Provenance
                source={item.source}
                at={item.retrievedAt}
                extra={index === 0 && <span>{t("research:shown")}</span>}
              />
              <IconButton
                tone="danger"
                label={t("research:deleteThisSnapshot")}
                icon={Trash2}
                size="sm"
                onClick={async () => {
                  if (
                    await confirm({
                      title: t("research:deleteThisSnapshot2"),
                      message: t("research:theDetailsItHoldsAreRemoved"),
                      confirmLabel: t("research:deleteSnapshot"),
                      tone: "danger",
                    })
                  ) {
                    await deleteSnapshot(item.id);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      </DetailBlock>
    </div>
  );
}
