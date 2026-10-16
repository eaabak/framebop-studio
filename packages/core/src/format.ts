function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `MM:SS:FF` timecode (or `H:MM:SS:FF` past an hour) at the given frame rate. */
export function formatTimecode(seconds: number, fps = 30): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const base = `${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

/** `M:SS` clock (or `H:MM:SS` past an hour), for rulers and transport readouts. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const secs = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/** Compact human duration: `4.5s`, `1m 05s`, `1h 02m`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m ${pad(secs)}s`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[exponent]}`;
}
