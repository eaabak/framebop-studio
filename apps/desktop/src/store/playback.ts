import { create } from "zustand";

/**
 * Transport state for the preview. Kept apart from the main store because it
 * changes many times per second during playback, and only the preview and the
 * timeline playhead should re-render when it does.
 */
interface PlaybackState {
  playing: boolean;
  /** Seconds into the selected scene. */
  time: number;
  /**
   * Set when playback moves to the next scene by itself, so the preview knows
   * to keep playing rather than wait for the user.
   */
  continueOnNextScene: boolean;
}

export const usePlayback = create<PlaybackState>(() => ({
  playing: false,
  time: 0,
  continueOnNextScene: false,
}));
