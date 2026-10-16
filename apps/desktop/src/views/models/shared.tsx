/** Pieces shared by the sections of the AI Models tab. */
import {
  GALLERY_STATUS_LABELS,
  type GalleryStatus,
  type GenerationCategory,
  type ModelInstallation,
  type ModelStatus,
  isActiveInstallation,
} from "@framebop/core";
import {
  AudioLines,
  Boxes,
  Clapperboard,
  Film,
  Image,
  ImagePlus,
  type LucideIcon,
  MessageSquareText,
  Mic,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge, cx } from "../../components/ui";
import { bridge } from "../../lib/bridge";
import { useStudio } from "../../store/studio";
import { t } from "../../i18n";

export const CATEGORY_LABELS: Record<GenerationCategory, string> = {
  get "text-to-image"() {
    return t("models:textToImage");
  },
  get "image-to-image"() {
    return t("models:imageToImage");
  },
  get "text-to-video"() {
    return t("models:textToVideo");
  },
  get "image-to-video"() {
    return t("models:imageToVideo");
  },
  get "text-to-speech"() {
    return t("models:textToSpeech");
  },
  get audio() {
    return t("models:audio");
  },
  get "text-generation"() {
    return t("models:languageModels");
  },
  get other() {
    return t("models:other");
  },
};

export const CATEGORY_ICONS: Record<GenerationCategory, LucideIcon> = {
  "text-to-image": Image,
  "image-to-image": ImagePlus,
  "text-to-video": Clapperboard,
  "image-to-video": Film,
  "text-to-speech": Mic,
  audio: AudioLines,
  "text-generation": MessageSquareText,
  other: Boxes,
};

export const STATE_LABELS: Record<ModelInstallation["state"], string> = {
  get queued() {
    return t("models:queued");
  },
  get downloading() {
    return t("models:downloading");
  },
  get verifying() {
    return t("models:verifying");
  },
  get installed() {
    return t("models:installed");
  },
  get failed() {
    return t("models:failed");
  },
  get cancelled() {
    return t("models:cancelled");
  },
  get interrupted() {
    return t("models:interrupted");
  },
};

const STATUS_TONES: Record<
  GalleryStatus,
  "neutral" | "accent" | "ok" | "warn" | "danger"
> = {
  ready: "ok",
  "installed-runtime-missing": "warn",
  external: "accent",
  downloading: "accent",
  "verification-failed": "danger",
  compatible: "accent",
  "compatibility-unknown": "neutral",
  insufficient: "danger",
  unsupported: "neutral",
};

/** The one status a model has in the gallery, never inferred from files. */
export function GalleryBadge({ status }: { status: ModelStatus }) {
  const { installation } = status;
  const label =
    status.gallery.status === "downloading" &&
    installation &&
    installation.bytesTotal > 0
      ? t("models:downloading2", {
          math: Math.floor(
            (installation.bytesDone / installation.bytesTotal) * 100,
          ),
        })
      : GALLERY_STATUS_LABELS[status.gallery.status];
  return <Badge tone={STATUS_TONES[status.gallery.status]}>{label}</Badge>;
}

export function useReveal() {
  const notify = useStudio((state) => state.notify);
  return (path: string) =>
    bridge
      .revealInFileManager(path)
      .catch(() => notify("error", t("models:theFolderCouldNotBeOpened")));
}

export function useCopy() {
  const notify = useStudio((state) => state.notify);
  return (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => notify("success", t("models:copied", { what })))
      .catch(() =>
        notify(
          "error",
          t("models:theCouldNotBeCopied", { toLowerCase: what.toLowerCase() }),
        ),
      );
}

export function useOpenWebPage() {
  const notify = useStudio((state) => state.notify);
  return (url: string) =>
    bridge
      .openWebPage(url)
      .catch(() => notify("error", t("models:thePageCouldNotBeOpened")));
}

/** Label and value pairs, laid out in a compact grid. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-2.5 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-2xs text-fg-dim">{label}</dt>
          <dd data-selectable className="break-words text-fg">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailBlock({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 card-surface rounded-xl border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-2xs font-semibold tracking-wide text-fg-dim uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const CHECK_TONES = {
  pass: "text-ok",
  fail: "text-danger",
  unknown: "text-fg-dim",
};
export const CHECK_MARKS = { pass: "✓", fail: "✕", unknown: "?" };

/** A check, with its result as a mark, then its label and explanation. */
export function CheckLine({
  result,
  label,
  detail,
}: {
  result: "pass" | "fail" | "unknown";
  label: string;
  detail: ReactNode;
}) {
  return (
    <li className="flex gap-2 text-xs leading-5">
      <span
        aria-hidden
        className={cx("w-3 shrink-0 font-semibold", CHECK_TONES[result])}
      >
        {CHECK_MARKS[result]}
      </span>
      <span className="min-w-0">
        <span className="text-fg">{label}:</span>{" "}
        <span className="text-fg-muted">{detail}</span>
      </span>
    </li>
  );
}

function hue(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/**
 * The picture on a model's card. Model repositories carry no thumbnails
 * that can be trusted, so this is a plain mark: the category's symbol on a
 * colour that belongs to the model's family, never an image of output.
 */
export function ModelArt({
  family,
  category,
  className,
}: {
  family: string;
  category: GenerationCategory | null;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[category ?? "other"];
  const h = hue(family || "model");
  return (
    <div
      aria-hidden
      className={cx(
        "relative flex items-center justify-center overflow-hidden",
        className,
      )}
      style={{
        background: `radial-gradient(120% 140% at 85% 0%, hsl(${h} 70% 42% / 0.55), transparent 60%), linear-gradient(160deg, hsl(${(h + 40) % 360} 45% 16%), hsl(222 40% 9%))`,
      }}
    >
      <Icon className="size-7 text-white/80" strokeWidth={1.5} />
      <span className="absolute right-2.5 bottom-1.5 font-mono text-[10px] tracking-wider text-white/45 uppercase">
        {family.slice(0, 14)}
      </span>
    </div>
  );
}

/** Why the Install action is unavailable, or null when it is. */
export function installBlocker(status: ModelStatus): string | null {
  const { entry, installation } = status;
  if (entry.access.gated) {
    return t("models:thisModelNeedsAHuggingFace");
  }
  if (installation && isActiveInstallation(installation)) {
    return t("models:alreadyDownloading");
  }
  if (installation?.state === "installed") return t("models:alreadyInstalled");
  return null;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
