/**
 * Plays a scene's 2D animation in the editor with the renderer's own scene
 * component: the poses, camera and pictures are evaluated from the frame
 * number exactly as in the exported video. Only the clock differs: here it
 * is the screen's, in the render every frame is drawn in turn.
 */
import type { AnimationPreview as Preview } from "@framebop/core";
import { AnimatedScene } from "@framebop/renderer/scene";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorState, Spinner } from "../components/ui";
import { bridge } from "../lib/bridge";
import { t } from "../i18n";

export function AnimationPreview({
  sceneId,
  version,
}: {
  sceneId: string;
  /** Changes when the animation does, to load it again. */
  version: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef<{ start: number; from: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    bridge
      .call("blueprint.animationPreview", { sceneId })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sceneId, version]);

  const frames = preview?.frames ?? 1;
  const fps = preview?.fps ?? 30;

  // Playback follows the screen's clock, so a slow frame is skipped rather
  // than slowing the animation down.
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    const tick = (now: number) => {
      const start = clock.current ?? { start: now, from: frame };
      clock.current = start;
      const next = start.from + Math.floor(((now - start.start) / 1000) * fps);
      if (next >= frames) {
        setFrame(frames - 1);
        setPlaying(false);
        return;
      }
      setFrame(next);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      clock.current = null;
    };
    // `frame` is only the starting point; it must not restart the loop.
  }, [playing, fps, frames]);

  const urls = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(preview?.images ?? {}).map(([key, asset]) => [
          key,
          bridge.mediaUrl(asset, "file"),
        ]),
      ),
    [preview],
  );

  if (error) return <ErrorState message={error} />;
  if (!preview?.animation) {
    return preview ? null : <Spinner />;
  }
  const spec = preview.animation;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative w-full overflow-hidden rounded bg-black"
        style={{ aspectRatio: `${spec.width} / ${spec.height}` }}
      >
        <AnimatedScene
          spec={spec}
          mouth={preview.mouth}
          frame={frame}
          fps={fps}
          urls={urls}
        />
      </div>
      <div className="flex items-center gap-2 text-2xs text-fg-dim">
        <Button
          size="sm"
          icon={playing ? Pause : Play}
          onClick={() => {
            if (!playing && frame >= frames - 1) setFrame(0);
            setPlaying(!playing);
          }}
        >
          {playing ? t("blueprint:pause") : t("blueprint:play")}
        </Button>
        <input
          type="range"
          className="flex-1"
          min={0}
          max={frames - 1}
          value={frame}
          aria-label={t("blueprint:frame")}
          onChange={(event) => {
            setPlaying(false);
            setFrame(Number(event.target.value));
          }}
        />
        <span className="tabular-nums">
          {t("blueprint:sFrame", {
            value: (frame / fps).toFixed(2),
            value2: frame + 1,
            frames,
          })}
        </span>
      </div>
    </div>
  );
}
