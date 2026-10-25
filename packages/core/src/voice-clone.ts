import { z } from "zod";

/**
 * Cloning the user's own voice for Qwen3-TTS.
 *
 * The user reads a known text aloud into the microphone. The recording,
 * cleaned up, becomes a voice profile's reference, and the text is its exact
 * transcript, so no speech recognition is needed. The text starts with a
 * spoken consent sentence naming the speaker, which stays in the recording.
 *
 * Only live microphone recordings are accepted: there is deliberately no way
 * to clone a voice from an audio file, so the voice cloned is the voice of
 * the person at the computer.
 */

/** Ways of reading the paragraph. The Base model copies the delivery. */
export const VOICE_STYLES = ["calm", "lively", "mysterious"] as const;
export const VoiceStyleSchema = z.enum(VOICE_STYLES);
export type VoiceStyle = z.infer<typeof VoiceStyleSchema>;

/** The speaker's name as spoken in the consent sentence. */
export const VoiceSpeakerSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[\p{L}][\p{L}\p{M} .'’-]*$/u,
    "Use letters, spaces, apostrophes, periods and hyphens only.",
  );

export function consentSentence(speaker: string): string {
  return `My name is ${speaker.trim()}, I am recording my own voice for Framebop Studio, and I agree to its use.`;
}

/**
 * About 35 seconds of narration with most English sounds in it, in the
 * series' storytelling register.
 */
export const VOICE_CLONE_PARAGRAPH =
  "Long ago, in a quiet harbor town, a curious young clockmaker found a strange brass box buried beneath an old oak tree. Inside were maps, a faded journal, and a silver key shaped like a feather. Nobody knew who had hidden them, or why. For years, the townspeople whispered theories by the fireside: a sunken treasure ship, a royal secret, a jealous rival. Today, historians believe the truth is even stranger. And that, my friends, is exactly why we keep asking questions.";

/** Exactly what the user reads: the consent sentence, then the paragraph. */
export function voiceCloneTranscript(speaker: string): string {
  return `${consentSentence(speaker)} ${VOICE_CLONE_PARAGRAPH}`;
}

/** Spoken with a new profile so the user can hear the clone. */
export const VOICE_PREVIEW_SENTENCE =
  "Welcome back, friends. Today's story is strange, but every word of it is true.";

/** Recordings shorter or longer than this are refused. */
export const VOICE_RECORDING_MIN_SECONDS = 15;
export const VOICE_RECORDING_MAX_SECONDS = 120;

/** How a profile's narration is paced after synthesis. */
export const VoicePacingSchema = z.object({
  sentenceGapSeconds: z.number().min(0).max(5),
  paragraphGapSeconds: z.number().min(0).max(10),
  /** Pitch-preserving tempo; 1 keeps the recorded pace. */
  tempo: z.number().min(0.5).max(2),
});
export type VoicePacing = z.infer<typeof VoicePacingSchema>;

/** Starting pace for each style; the user can change it per profile. */
export const VOICE_STYLE_PACING: Record<VoiceStyle, VoicePacing> = {
  calm: { sentenceGapSeconds: 0.6, paragraphGapSeconds: 1.2, tempo: 1 },
  lively: { sentenceGapSeconds: 0.4, paragraphGapSeconds: 0.9, tempo: 1 },
  mysterious: {
    sentenceGapSeconds: 0.8,
    paragraphGapSeconds: 1.5,
    tempo: 0.96,
  },
};

/** A profile folder's name. Matches what the speech engine reads. */
export const VoiceProfileIdSchema = z
  .string()
  .regex(/^[\w][\w .-]{0,127}$/, "Not a voice profile name.");

export const VoiceProfileInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Recorded by the user, with consent, through "Clone your voice". */
  ownRecording: z.boolean(),
  speaker: z.string().nullable(),
  style: VoiceStyleSchema.nullable(),
  recordedAt: z.string().nullable(),
  provenance: z.string(),
  referenceSeconds: z.number().nonnegative(),
  pacing: VoicePacingSchema,
});
export type VoiceProfileInfo = z.infer<typeof VoiceProfileInfoSchema>;

export const VoiceLibrarySchema = z.object({
  /** The folder of profiles in Settings, or null when none is chosen. */
  directory: z.string().nullable(),
  profiles: z.array(VoiceProfileInfoSchema),
  /** Folders with a voice.json that cannot be used, and why. */
  problems: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type VoiceLibrary = z.infer<typeof VoiceLibrarySchema>;

export const VoicePreviewSchema = z.object({
  state: z.enum(["idle", "running", "done", "failed"]),
  profileId: z.string().nullable(),
  /** The spoken sample as a base64 WAV, once done. */
  audio: z.string().nullable(),
  error: z.string().nullable(),
});
export type VoicePreview = z.infer<typeof VoicePreviewSchema>;

/**
 * Base64 of a 16-bit mono WAV of at most VOICE_RECORDING_MAX_SECONDS at
 * 48 kHz, with room for a 96 kHz microphone.
 */
export const VOICE_RECORDING_MAX_BASE64 = Math.ceil(
  ((VOICE_RECORDING_MAX_SECONDS * 96_000 * 2 + 1024) * 4) / 3,
);
