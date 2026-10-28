import { formatTimecode, isActiveJob } from "@framebop/core";
import {
  Film,
  ImageIcon,
  ImageOff,
  ListVideo,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { sceneLabel, visualAssetOf } from "../../components/media";
import { GenerationPreview } from "../../components/GenerationPreview";
import { Button, IconButton, cx } from "../../components/ui";
import { bridge } from "../../lib/bridge";
import { usePlayback } from "../../store/playback";
import { useSelectedScene, useStudio } from "../../store/studio";
import { t } from "../../i18n";

interface TransportProps {
  duration: number;
  disabled: boolean;
  muted: boolean;
  hasSound: boolean;
  onToggle(): void;
  onSeek(time: number): void;
  onToggleMute(): void;
}

function Transport({
  duration,
  disabled,
  muted,
  hasSound,
  onToggle,
  onSeek,
  onToggleMute,
}: TransportProps) {
  const playing = usePlayback((state) => state.playing);
  const time = usePlayback((state) => state.time);
  const continuous = useStudio((state) => state.settings.continuousPlayback);
  const updateSettings = useStudio((state) => state.updateSettings);
  const selectAdjacentScene = useStudio((state) => state.selectAdjacentScene);
  const position = Math.min(time, duration);

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-3">
      <div className="flex items-center gap-0.5">
        <IconButton
          label={t("editor:previousScene")}
          icon={SkipBack}
          onClick={() => selectAdjacentScene(-1)}
        />
        <button
          type="button"
          aria-label={playing ? t("editor:pause") : t("editor:play")}
          title={playing ? t("editor:pauseSpace") : t("editor:playSpace")}
          disabled={disabled}
          onClick={onToggle}
          className="flex size-8 items-center justify-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:opacity-30"
        >
          {playing ? (
            <Pause className="size-4 fill-current" aria-hidden />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" aria-hidden />
          )}
        </button>
        <IconButton
          label={t("editor:nextScene")}
          icon={SkipForward}
          onClick={() => selectAdjacentScene(1)}
        />
      </div>

      <span className="timecode shrink-0 text-xs text-fg">
        {formatTimecode(position)}
        <span className="text-fg-dim"> / {formatTimecode(duration)}</span>
      </span>

      <input
        type="range"
        aria-label={t("editor:positionInScene")}
        className="slider min-w-0 flex-1"
        min={0}
        max={duration || 1}
        step={0.01}
        value={position}
        disabled={disabled}
        style={
          {
            "--fill": `${duration ? (position / duration) * 100 : 0}%`,
          } as React.CSSProperties
        }
        onChange={(event) => onSeek(Number(event.target.value))}
      />

      <div className="flex items-center gap-0.5">
        <IconButton
          label={muted ? t("editor:unmuteClip") : t("editor:muteClip")}
          icon={muted ? VolumeX : Volume2}
          disabled={!hasSound}
          onClick={onToggleMute}
        />
        <IconButton
          label={
            continuous
              ? t("editor:continuousPlaybackIsOnTheNext")
              : t("editor:continuousPlaybackIsOffPlaybackStops")
          }
          icon={ListVideo}
          active={continuous}
          onClick={() =>
            void updateSettings({ continuousPlayback: !continuous })
          }
        />
      </div>
    </div>
  );
}

export function Preview({ dropActive }: { dropActive: boolean }) {
  const scene = useSelectedScene();
  const index = useStudio((state) =>
    state.scenes.findIndex(
      (candidate) => candidate.id === state.selectedSceneId,
    ),
  );
  const sceneCount = useStudio((state) => state.scenes.length);
  const assets = useStudio((state) => state.assets);
  const importMedia = useStudio((state) => state.importMedia);
  const reportAssetMetadata = useStudio((state) => state.reportAssetMetadata);
  const playing = usePlayback((state) => state.playing);

  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [clipDuration, setClipDuration] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);

  const asset = scene ? visualAssetOf(scene, assets) : null;
  const active = useStudio((state) =>
    state.jobs.find(
      (job) =>
        job.sceneId === scene?.id &&
        job.type === "video_generation" &&
        isActiveJob(job),
    ),
  );
  const isVideo = asset?.kind === "video" && !broken && !active;
  const sceneId = scene?.id ?? null;
  const assetId = asset?.id ?? null;
  // A clip plays for its own length; a still or an empty scene is held for
  // the length the scene is planned to last.
  const duration = isVideo
    ? (clipDuration ?? asset?.durationSeconds ?? scene?.durationSeconds ?? 0)
    : (scene?.durationSeconds ?? 0);

  // Selecting another scene (or replacing its media) restarts the transport.
  // If playback arrived here by itself, it keeps going.
  useEffect(() => {
    const { continueOnNextScene } = usePlayback.getState();
    usePlayback.setState({
      time: 0,
      playing: continueOnNextScene && sceneId !== null,
      continueOnNextScene: false,
    });
    setClipDuration(null);
    setBroken(false);
  }, [sceneId, assetId]);

  const finish = useCallback(() => {
    const studio = useStudio.getState();
    if (studio.settings.continuousPlayback) {
      usePlayback.setState({ continueOnNextScene: true });
      if (studio.selectAdjacentScene(1)) return;
    }
    usePlayback.setState({ playing: false, continueOnNextScene: false });
  }, []);

  // Drive the <video> element from the transport state.
  useEffect(() => {
    const element = video.current;
    if (!isVideo || !element) return;
    if (playing) {
      element.play().catch(() => usePlayback.setState({ playing: false }));
    } else {
      element.pause();
    }
  }, [playing, isVideo, assetId]);

  // Advance the clock every frame: read it from the clip, or count it for a still.
  useEffect(() => {
    if (!playing || active) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if (isVideo) {
        if (video.current)
          usePlayback.setState({ time: video.current.currentTime });
      } else {
        const next = usePlayback.getState().time + (now - previous) / 1000;
        if (next >= duration) {
          usePlayback.setState({ time: duration });
          finish();
          return;
        }
        usePlayback.setState({ time: next });
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, isVideo, duration, finish, active?.id]);

  const seek = (time: number) => {
    if (isVideo && video.current) video.current.currentTime = time;
    usePlayback.setState({ time });
  };

  const toggle = () => {
    if (active) return;
    const { playing: isPlaying, time } = usePlayback.getState();
    // Pressing play at the end starts over rather than doing nothing.
    if (!isPlaying && time >= duration - 0.05) seek(0);
    usePlayback.setState({ playing: !isPlaying });
  };

  // Expose the toggle to the keyboard shortcut in the parent view.
  useEffect(() => {
    const onToggle = () => {
      if (sceneId !== null) toggle();
    };
    window.addEventListener("framebop:toggle-playback", onToggle);
    return () =>
      window.removeEventListener("framebop:toggle-playback", onToggle);
  });

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-canvas"
      aria-label={t("editor:preview")}
    >
      <div className="stage-fit flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          data-drop-zone="scene"
          className={cx(
            "stage relative overflow-hidden rounded-lg bg-stage shadow-[0_0_0_1px_var(--color-line),0_24px_60px_-20px_rgb(0_0_0/0.9)] transition-shadow",
            dropActive &&
              "shadow-[0_0_0_2px_var(--color-accent),0_0_40px_-8px_var(--color-accent)]",
          )}
        >
          {!scene ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-fg-dim">
              <Film className="size-7" strokeWidth={1.25} aria-hidden />
              <p className="text-xs">{t("editor:selectASceneToPreviewIt")}</p>
            </div>
          ) : active ? (
            <GenerationPreview className="size-full" />
          ) : !asset ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 text-center">
              <ImageIcon
                className="size-7 text-fg-dim"
                strokeWidth={1.25}
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium text-fg">
                  {t("editor:thisSceneHasNoVisualsYet")}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {t("editor:importAStillImageOrA")}
                  {bridge.native && t("editor:orDropAFileHere")}.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  icon={Upload}
                  onClick={() => void importMedia(scene.id, "image")}
                >
                  {t("editor:importImage")}
                </Button>
                <Button
                  icon={Upload}
                  onClick={() => void importMedia(scene.id, "video")}
                >
                  {t("editor:importVideo")}
                </Button>
              </div>
            </div>
          ) : broken ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 px-8 text-center">
              <ImageOff
                className="size-7 text-warn"
                strokeWidth={1.25}
                aria-hidden
              />
              <p className="text-sm font-medium text-fg">
                {t("editor:thisMediaCannotBeShown")}
              </p>
              <p className="max-w-md text-xs leading-5 text-fg-muted">
                {t("editor:isMissingFromTheLibraryOr", {
                  originalFilename: asset.originalFilename,
                })}
              </p>
            </div>
          ) : asset.kind === "video" ? (
            <video
              key={asset.id}
              ref={video}
              src={bridge.mediaUrl(asset, "file")}
              muted={muted}
              playsInline
              preload="auto"
              className="size-full object-contain"
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                const length = Number.isFinite(element.duration)
                  ? element.duration
                  : null;
                if (length !== null) setClipDuration(length);
                reportAssetMetadata(asset, {
                  width: element.videoWidth,
                  height: element.videoHeight,
                  durationSeconds: length,
                });
              }}
              onEnded={finish}
              onError={() => setBroken(true)}
              onClick={toggle}
            />
          ) : (
            <img
              key={asset.id}
              src={bridge.mediaUrl(asset, "file")}
              alt={scene.description || sceneLabel(scene, index)}
              draggable={false}
              className="size-full object-contain"
              onLoad={(event) =>
                reportAssetMetadata(asset, {
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                  durationSeconds: null,
                })
              }
              onError={() => setBroken(true)}
            />
          )}

          {scene && !active && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
              <span className="timecode rounded bg-black/60 px-1.5 py-0.5 text-2xs font-semibold tracking-wider text-fg backdrop-blur">
                {t("editor:scene4", {
                  index: String(index + 1).padStart(2, "0"),
                })}
                <span className="text-fg-dim">
                  {" "}
                  / {String(sceneCount).padStart(2, "0")}
                </span>
              </span>
              {asset && !broken && !active && (
                <span className="timecode rounded bg-black/60 px-1.5 py-0.5 text-2xs text-fg-muted backdrop-blur">
                  {asset.kind === "video" ? "CLIP" : "STILL"}
                  {asset.width && asset.height
                    ? ` · ${asset.width}×${asset.height}`
                    : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {scene && (
        <div className="flex shrink-0 items-baseline gap-3 px-4 pb-2.5">
          <h2 className="shrink-0 text-sm font-semibold text-fg">
            {sceneLabel(scene, index)}
          </h2>
          <p className="truncate text-xs text-fg-muted">
            {scene.description ||
              scene.narrationText ||
              t("editor:noDescription")}
          </p>
        </div>
      )}

      <Transport
        duration={duration}
        disabled={!scene || Boolean(active)}
        muted={muted}
        hasSound={isVideo}
        onToggle={toggle}
        onSeek={seek}
        onToggleMute={() => setMuted((value) => !value)}
      />
    </section>
  );
}
