import type { Asset, Scene } from "@framebop/core";
import { AudioLines, Film, ImageIcon, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../lib/bridge";
import { cx } from "./ui";
import { t } from "../i18n";

/** A scene's display name: its title, or its position when untitled. */
export function sceneLabel(scene: Pick<Scene, "title">, index: number): string {
  return scene.title.trim() || t("common:scene", { value: index + 1 });
}

/** The asset the preview shows for a scene: its clip if present, else its still. */
export function visualAssetOf(
  scene: Scene,
  assets: Record<string, Asset>,
): Asset | null {
  return (
    assets[scene.videoAssetId ?? ""] ?? assets[scene.imageAssetId ?? ""] ?? null
  );
}

interface AssetThumbProps {
  asset: Asset | null;
  className?: string;
  /** Shown instead of an icon when there is no asset. */
  placeholder?: string;
}

/**
 * A small still preview of an asset. Uses the generated thumbnail when the
 * engine could create one, and otherwise renders the media itself: the image
 * directly, or the first frame of a clip.
 */
export function AssetThumb({ asset, className, placeholder }: AssetThumbProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset?.id]);

  const frame = cx(
    "relative flex items-center justify-center overflow-hidden bg-stage text-fg-dim",
    className,
  );

  if (asset === null) {
    return (
      <div className={frame}>
        {placeholder ? (
          <span className="text-2xs font-semibold tracking-wide">
            {placeholder}
          </span>
        ) : (
          <ImageIcon
            className="size-4 opacity-50"
            strokeWidth={1.5}
            aria-hidden
          />
        )}
      </div>
    );
  }
  if (failed) {
    return (
      <div className={frame} title={t("common:thisMediaFileIsMissingFrom")}>
        <ImageOff
          className="size-4 text-warn"
          strokeWidth={1.75}
          aria-label={t("common:mediaMissing")}
        />
      </div>
    );
  }
  if (asset.kind === "audio") {
    return (
      <div className={frame}>
        <AudioLines className="size-4" strokeWidth={1.75} aria-hidden />
      </div>
    );
  }

  const media = "absolute inset-0 size-full object-cover";
  if (asset.thumbnailPath || asset.kind === "image") {
    return (
      <div className={frame}>
        <img
          src={bridge.mediaUrl(
            asset,
            asset.thumbnailPath ? "thumbnail" : "file",
          )}
          alt=""
          draggable={false}
          loading="lazy"
          className={media}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <div className={frame}>
      {/* `#t` seeks past the first frame, which is often black. */}
      <video
        src={`${bridge.mediaUrl(asset, "file")}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        className={media}
        onError={() => setFailed(true)}
      />
      <Film
        className="absolute right-1 bottom-1 size-3 text-fg drop-shadow"
        aria-hidden
      />
    </div>
  );
}
