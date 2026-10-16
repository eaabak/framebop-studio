import type { CoverageItem, ReferenceVideoDetail } from "@framebop/core";
import {
  Check,
  CircleDashed,
  CircleSlash,
  EyeOff,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Badge, cx } from "../../components/ui";
import { DetailBlock } from "../models/shared";
import { Provenance } from "./shared";
import { t } from "../../i18n";

const STATES: Record<
  CoverageItem["state"],
  {
    label: string;
    tone: "ok" | "warn" | "neutral" | "danger";
    icon: typeof Check;
  }
> = {
  collected: {
    get label() {
      return t("research:collected");
    },
    tone: "ok",
    icon: Check,
  },
  partial: {
    get label() {
      return t("research:partlyCollected");
    },
    tone: "warn",
    icon: CircleDashed,
  },
  missing: {
    get label() {
      return t("research:missing");
    },
    tone: "neutral",
    icon: CircleSlash,
  },
  hidden: {
    get label() {
      return t("research:notPublic");
    },
    tone: "neutral",
    icon: EyeOff,
  },
};

export function SourcesPanel({ detail }: { detail: ReferenceVideoDetail }) {
  const { coverage, snapshot } = detail;
  return (
    <div className="flex flex-col gap-4">
      <DetailBlock title={t("research:whatHasBeenCollected")}>
        <ul className="flex flex-col divide-y divide-line">
          {coverage.items.map((item) => {
            const state = STATES[item.state];
            return (
              <li key={item.key} className="flex gap-3 py-2.5">
                <state.icon
                  className={cx(
                    "mt-0.5 size-4 shrink-0",
                    item.state === "collected"
                      ? "text-ok"
                      : item.state === "partial"
                        ? "text-warn"
                        : "text-fg-dim",
                  )}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ui font-medium text-fg">
                      {item.label}
                    </span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                  <p
                    data-selectable
                    className="text-xs leading-5 text-fg-muted"
                  >
                    {item.detail}
                  </p>
                  {item.source && item.retrievedAt && (
                    <Provenance source={item.source} at={item.retrievedAt} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </DetailBlock>

      <DetailBlock title={t("research:notAvailableFromAnyPublicSource")}>
        <p className="text-xs leading-5 text-fg-muted">
          {t("research:framebopDoesNotEstimateTheseThey")}
        </p>
        <ul className="flex flex-col gap-2">
          {coverage.unavailable.map((item) => (
            <li key={item.label} className="flex gap-2.5">
              <Lock
                className="mt-0.5 size-3.5 shrink-0 text-fg-dim"
                aria-hidden
              />
              <div>
                <p className="text-xs font-medium text-fg">{item.label}</p>
                <p className="text-2xs leading-4 text-fg-dim">{item.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      </DetailBlock>

      {snapshot && snapshot.requests.length > 0 && (
        <DetailBlock title={t("research:requestsBehindTheShownDetails")}>
          <ul className="flex flex-col gap-1">
            {snapshot.requests.map((request) => (
              <li key={request} className="font-mono text-2xs text-fg-muted">
                {request}
              </li>
            ))}
          </ul>
          <p className="text-2xs text-fg-dim">
            {t("research:ofTheKeySDailyYoutube", {
              quotaUnits: snapshot.quotaUnits,
            })}
          </p>
        </DetailBlock>
      )}

      <div className="flex gap-2.5 rounded-lg border border-ok/20 bg-ok/5 p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        <p className="text-xs leading-5 text-fg-muted">
          {t("research:requestsGoOnlyToTheYoutube")}
        </p>
      </div>
    </div>
  );
}
