/** Easing curves for keyframed motion, shared by every animation kind. */
import { z } from "zod";

export const EASES = [
  "linear",
  "inSine",
  "outSine",
  "inOutSine",
  "inCubic",
  "outCubic",
  "inOutCubic",
  "outBack",
] as const;
export const EaseSchema = z.enum(EASES);
export type Ease = z.infer<typeof EaseSchema>;
