import type { EngineCapability } from "@framebop/core";
import { Check, FlaskConical, Minus, TriangleAlert } from "lucide-react";
import { cx } from "./ui";
import { t } from "../i18n";

export const TASK_LABELS: Record<EngineCapability["task"], string> = {
  get image_generation() {
    return t("common:images");
  },
  get video_generation() {
    return t("common:videoClips");
  },
  get audio_generation() {
    return t("common:audio");
  },
  get video_render() {
    return t("common:rendering");
  },
};

function Fact({
  supported,
  children,
}: {
  supported: boolean;
  children: string;
}) {
  const Icon = supported ? Check : Minus;
  return (
    <li className="flex items-start gap-1.5">
      <Icon
        className={cx(
          "mt-0.5 size-3 shrink-0",
          supported ? "text-ok" : "text-fg-dim",
        )}
        aria-hidden
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * States plainly what an engine will and will not do for one task, so that
 * nobody starts a run expecting a progress bar or a stop button that the
 * engine cannot provide.
 */
export function CapabilitySummary({
  capability,
}: {
  capability: EngineCapability;
}) {
  return (
    <div className="flex flex-col gap-2 text-2xs leading-4 text-fg-muted">
      {capability.maturity === "test" && (
        <p className="flex items-start gap-1.5 rounded border border-warn/30 bg-warn/10 p-2 text-warn">
          <FlaskConical className="mt-0.5 size-3 shrink-0" aria-hidden />
          {t("common:testAdapterItDrawsATest")}
        </p>
      )}
      {capability.maturity === "experimental" && (
        <p className="flex items-start gap-1.5 rounded border border-line-strong bg-raised p-2">
          <TriangleAlert
            className="mt-0.5 size-3 shrink-0 text-warn"
            aria-hidden
          />
          {t("common:experimentalBuiltFromTheEngineS")}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        <Fact supported={capability.supportsCancellation}>
          {capability.supportsCancellation
            ? t("common:canBeStoppedWhileItRuns")
            : t("common:cannotBeStoppedOnceItHas")}
        </Fact>
        <Fact supported={capability.reportsProgress}>
          {capability.reportsProgress
            ? t("common:reportsItsRealProgress")
            : t("common:reportsNoProgressOnlyThatIt")}
        </Fact>
        {capability.requiresInputImage && (
          <Fact supported>{t("common:startsFromTheSceneSStill")}</Fact>
        )}
        {capability.expensive && (
          <Fact supported>
            {t("common:asksForYourConfirmationBeforeEvery")}
          </Fact>
        )}
      </ul>
      {capability.notes.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-fg-dim">
          {capability.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
