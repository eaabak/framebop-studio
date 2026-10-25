/**
 * Hosts a WebGL world in React, the way the PixiJS scene does: the world is
 * made once, then drawn synchronously for every frame it is given, and the
 * render is held until the first frame is drawn and `ready` (fonts loaded).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Hold } from "../animation/PixiScene";

export interface Drawable {
  readonly canvas: HTMLCanvasElement;
  draw(frame: number): void;
  dispose(): void;
}

export function WebGLScene({
  create,
  frame,
  hold,
  ready = true,
}: {
  /** Makes the world; a new function makes a new world. */
  create: () => Drawable;
  frame: number;
  hold?: () => Hold;
  /** Whatever else the picture needs is in place. */
  ready?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [world, setWorld] = useState<Drawable | null>(null);
  const waiting = useRef<Hold | null>(null);

  useEffect(() => {
    const pending = hold?.() ?? null;
    waiting.current = pending;
    let made: Drawable | null = null;
    try {
      made = create();
      made.canvas.style.width = "100%";
      made.canvas.style.height = "100%";
      made.canvas.style.display = "block";
      host.current?.appendChild(made.canvas);
      setWorld(made);
    } catch (error) {
      waiting.current = null;
      pending?.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return () => {
      setWorld(null);
      waiting.current?.release();
      waiting.current = null;
      if (made) {
        made.canvas.remove();
        made.dispose();
      }
    };
  }, [create, hold]);

  useLayoutEffect(() => {
    if (!world) return;
    world.draw(frame);
    if (ready) {
      waiting.current?.release();
      waiting.current = null;
    }
  }, [world, frame, ready]);

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}

/** Whether the motion-graphics font has loaded, so text is laid out right. */
export function useFontsReady(font: string): boolean {
  const [ready, setReady] = useState(
    () => typeof document === "undefined" || document.fonts.check(font),
  );
  useEffect(() => {
    if (ready) return;
    let live = true;
    document.fonts
      .load(font)
      .catch(() => [])
      .then(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [font, ready]);
  return ready;
}

/**
 * Holds the render (through `hold`) from mount until `ready`, for scenes
 * drawn without WebGL that still wait for their font.
 */
export function useHold(hold: (() => Hold) | undefined, ready: boolean) {
  const waiting = useRef<Hold | null>(null);
  const isReady = useRef(ready);
  isReady.current = ready;
  useEffect(() => {
    // Layout effects run first, so a scene ready at once is released here.
    waiting.current = isReady.current ? null : (hold?.() ?? null);
    return () => {
      waiting.current?.release();
      waiting.current = null;
    };
  }, [hold]);
  useLayoutEffect(() => {
    if (ready) {
      waiting.current?.release();
      waiting.current = null;
    }
  }, [ready]);
}
