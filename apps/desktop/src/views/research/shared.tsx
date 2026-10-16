import {
  type FindingBasis,
  RESEARCH_SOURCE_LABELS,
  type ResearchSource,
  YOUTUBE_DATA_MAX_AGE_DAYS,
  isOlderThanDays,
} from "@framebop/core";
import {
  AlertTriangle,
  Clock,
  KeyRound,
  PencilLine,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Button, cx } from "../../components/ui";
import { openPanel } from "../../lib/dialogs";
import { type ResearchFailure, useResearch } from "../../store/research";
import { currentLanguage, t } from "../../i18n";

export function formatNumber(value: number): string {
  return value.toLocaleString(currentLanguage());
}

export function formatDate(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  // A bare date (as entered by hand) has no time worth showing.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`).toLocaleDateString(currentLanguage(), {
        dateStyle: "medium",
      })
    : new Date(time).toLocaleString(currentLanguage(), {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

const SOURCE_TONES: Record<
  ResearchSource,
  "accent" | "neutral" | "ok" | "warn"
> = {
  "youtube-data-api": "accent",
  manual: "warn",
  "transcript-file": "neutral",
  "framebop-rules": "ok",
  user: "neutral",
};

export function SourceBadge({ source }: { source: ResearchSource }) {
  return (
    <Badge tone={SOURCE_TONES[source]}>{RESEARCH_SOURCE_LABELS[source]}</Badge>
  );
}

export function BasisBadge({ basis }: { basis: FindingBasis }) {
  return basis === "observed" ? (
    <Badge tone="ok">{t("research:observed")}</Badge>
  ) : (
    <Badge tone="warn">{t("research:inferred")}</Badge>
  );
}

/** "From the YouTube Data API, 14 Oct 2026" with a warning past 30 days. */
export function Provenance({
  source,
  at,
  extra,
}: {
  source: ResearchSource;
  at: string;
  extra?: ReactNode;
}) {
  const stale =
    source === "youtube-data-api" &&
    isOlderThanDays(at, YOUTUBE_DATA_MAX_AGE_DAYS);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-dim">
      <SourceBadge source={source} />
      <span>{formatDate(at)}</span>
      {extra}
      {stale && (
        <span className="inline-flex items-center gap-1 text-warn">
          <Clock className="size-3" aria-hidden />
          {t("research:olderThanDaysRefreshOrDelete", {
            yOUTUBE_DATA_MAX_AGE_DAYS: YOUTUBE_DATA_MAX_AGE_DAYS,
          })}
        </span>
      )}
    </div>
  );
}

const FAILURE_TITLES: Partial<
  Record<NonNullable<ResearchFailure["reason"]>, string>
> = {
  get "key-missing"() {
    return t("research:aYoutubeApiKeyIsNeeded");
  },
  get "key-invalid"() {
    return t("research:youtubeRefusedTheApiKey");
  },
  get "key-restricted"() {
    return t("research:theApiKeySRestrictionsBlock");
  },
  get "api-disabled"() {
    return t("research:theYoutubeDataApiIsNot");
  },
  get "quota-exceeded"() {
    return t("research:todaySYoutubeQuotaIsUsed");
  },
  get "rate-limited"() {
    return t("research:youtubeIsLimitingRequests");
  },
  get offline() {
    return t("research:youtubeCouldNotBeReached");
  },
  get "not-found"() {
    return t("research:youtubeHasNoPublicVideoWith");
  },
};

/** Where a YouTube request failed, why, and what can be done instead. */
export function FailureBanner({
  failure,
  onEnterManually,
}: {
  failure: ResearchFailure;
  onEnterManually?: () => void;
}) {
  const clearFailure = useResearch((state) => state.clearFailure);
  const reason = failure.reason;
  const keyProblem =
    reason === "key-missing" ||
    reason === "key-invalid" ||
    reason === "key-restricted" ||
    reason === "api-disabled";
  const Icon =
    reason === "offline"
      ? WifiOff
      : keyProblem
        ? KeyRound
        : reason === "quota-exceeded"
          ? Clock
          : AlertTriangle;
  const tone =
    reason === "quota-exceeded" ||
    reason === "rate-limited" ||
    reason === "offline"
      ? "border-warn/30 bg-warn/5"
      : "border-danger/30 bg-danger/5";
  return (
    <div role="alert" className={cx("flex gap-3 rounded-lg border p-3", tone)}>
      <Icon
        className={cx(
          "mt-0.5 size-4 shrink-0",
          tone.startsWith("border-warn") ? "text-warn" : "text-danger",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="text-ui font-medium text-fg">
            {(reason && FAILURE_TITLES[reason]) ??
              t("research:youtubeCouldNotBeAsked2")}
          </p>
          <p data-selectable className="text-xs leading-5 text-fg-muted">
            {failure.message}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {keyProblem && (
            <Button
              size="sm"
              icon={KeyRound}
              onClick={() => openPanel("settings")}
            >
              {t("research:openSettings")}
            </Button>
          )}
          {failure.action === "metadata" &&
            onEnterManually &&
            reason !== "not-found" && (
              <Button size="sm" icon={PencilLine} onClick={onEnterManually}>
                {t("research:enterDetailsByHand")}
              </Button>
            )}
          <Button size="sm" variant="ghost" onClick={clearFailure}>
            {t("research:dismiss")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A labelled value, or why there is none. */
export function Value({
  label,
  children,
  missing,
  note,
}: {
  label: string;
  children?: ReactNode;
  missing?: string | null;
  note?: string | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-fg-dim">{label}</dt>
      <dd data-selectable className="break-words text-xs">
        {missing ? (
          <span className="text-fg-dim italic">{missing}</span>
        ) : (
          <span className="text-fg">{children}</span>
        )}
      </dd>
      {note && <p className="mt-0.5 text-2xs leading-4 text-fg-dim">{note}</p>}
    </div>
  );
}
