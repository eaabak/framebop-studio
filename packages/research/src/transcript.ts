/**
 * Reads transcripts the user imports: WebVTT, SubRip (SRT) or plain text,
 * with or without timestamps. Problems are reported with the line they are
 * on; nothing is guessed or repaired silently.
 */
import { AppError, type TranscriptFormat } from "@framebop/core";

export interface ParsedSegment {
  startMs: number | null;
  endMs: number | null;
  text: string;
}

export interface ParsedTranscript {
  format: TranscriptFormat;
  segments: ParsedSegment[];
  hasTimestamps: boolean;
  warnings: string[];
}

export const MAX_SEGMENTS = 20_000;
const LONG_LINE = 600;

function invalid(message: string): AppError {
  return new AppError("VALIDATION", message);
}

/** WebVTT if it says so, SRT if it looks like it or is named so, else text. */
export function detectTranscriptFormat(
  fileName: string,
  content: string,
): TranscriptFormat {
  const start = content.replace(/^﻿/, "").trimStart();
  if (/^WEBVTT(?:[ \t]|$|\r?\n)/.test(start)) return "webvtt";
  const name = fileName.toLowerCase();
  if (name.endsWith(".vtt")) return "webvtt";
  if (
    name.endsWith(".srt") ||
    /^\d+\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(start)
  ) {
    return "srt";
  }
  return "text";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

/** Removes markup (<i>, <v Speaker>, inline times, {\an8}) and entities. */
function cleanCueText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** 00:01:02.345, 01:02.345 (WebVTT) or 00:01:02,345 (SRT), in milliseconds. */
export function parseCueTime(
  value: string,
  separator: "." | ",",
): number | null {
  const pattern =
    separator === "."
      ? /^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/
      : /^(\d{1,3}):([0-5]\d):([0-5]\d),(\d{3})$/;
  const match = pattern.exec(value);
  if (!match) return null;
  const [, hours, minutes, seconds, millis] = match;
  return (
    ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) *
      1000 +
    Number(millis)
  );
}

interface Line {
  number: number;
  text: string;
}

function blocksOf(content: string): Line[][] {
  const lines = content.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const blocks: Line[][] = [];
  let current: Line[] = [];
  lines.forEach((text, index) => {
    if (text.trim() === "") {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push({ number: index + 1, text });
    }
  });
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function parseTiming(
  line: Line,
  separator: "." | ",",
  example: string,
): { startMs: number; endMs: number } {
  const match = /^\s*(\S+)\s+-->\s+(\S+)/.exec(line.text);
  const startMs = match?.[1] ? parseCueTime(match[1], separator) : null;
  const endMs = match?.[2] ? parseCueTime(match[2], separator) : null;
  if (startMs === null || endMs === null) {
    throw invalid(
      `Line ${line.number}: expected a cue timing such as ${example}.`,
    );
  }
  if (endMs < startMs) {
    throw invalid(`Line ${line.number}: the cue ends before it starts.`);
  }
  return { startMs, endMs };
}

/**
 * Rolling captions (as in YouTube's automatic ones) repeat the previous
 * cue's last line at the start of the next. Those repeats are dropped.
 */
function withoutRollingRepeats(
  cues: { startMs: number; endMs: number; lines: string[] }[],
): { segments: ParsedSegment[]; removed: number } {
  const segments: ParsedSegment[] = [];
  let previous: string[] = [];
  let removed = 0;
  for (const cue of cues) {
    let lines = cue.lines;
    while (lines.length > 0 && previous.includes(lines[0] ?? "")) {
      lines = lines.slice(1);
      removed += 1;
    }
    if (cue.lines.length > 0) previous = cue.lines;
    const text = lines.join(" ").trim();
    if (text) segments.push({ startMs: cue.startMs, endMs: cue.endMs, text });
  }
  return { segments, removed };
}

function parseWebVtt(content: string): ParsedTranscript {
  const blocks = blocksOf(content);
  const header = blocks[0]?.[0];
  if (!header || !/^WEBVTT(?:[ \t]|$)/.test(header.text)) {
    throw invalid("A WebVTT file must start with the line WEBVTT.");
  }
  const cues: { startMs: number; endMs: number; lines: string[] }[] = [];
  for (const block of blocks.slice(1)) {
    const first = block[0];
    if (!first || /^(NOTE|STYLE|REGION)(\s|$)/.test(first.text)) continue;
    const timingIndex = first.text.includes("-->") ? 0 : 1;
    const timingLine = block[timingIndex];
    if (!timingLine || !timingLine.text.includes("-->")) {
      throw invalid(
        `Line ${first.number}: expected a cue timing such as 00:00:01.000 --> 00:00:04.000.`,
      );
    }
    const timing = parseTiming(
      timingLine,
      ".",
      "00:00:01.000 --> 00:00:04.000",
    );
    const lines = block
      .slice(timingIndex + 1)
      .map((line) => cleanCueText(line.text))
      .filter(Boolean);
    cues.push({ ...timing, lines });
  }
  const { segments, removed } = withoutRollingRepeats(cues);
  const warnings =
    removed > 0
      ? [
          `${removed} repeated caption line${removed === 1 ? " was" : "s were"} removed (rolling captions).`,
        ]
      : [];
  return { format: "webvtt", segments, hasTimestamps: true, warnings };
}

function parseSrt(content: string): ParsedTranscript {
  const cues: { startMs: number; endMs: number; lines: string[] }[] = [];
  for (const block of blocksOf(content)) {
    const first = block[0];
    if (!first) continue;
    const timingIndex = /^\d+$/.test(first.text.trim()) ? 1 : 0;
    const timingLine = block[timingIndex];
    if (!timingLine || !timingLine.text.includes("-->")) {
      throw invalid(
        `Line ${(timingLine ?? first).number}: expected a timing line such as 00:00:01,000 --> 00:00:04,000.`,
      );
    }
    // Some tools write SRT with WebVTT's full stop; both are read.
    const separator = timingLine.text.includes(",") ? "," : ".";
    const timing = parseTiming(
      timingLine,
      separator,
      "00:00:01,000 --> 00:00:04,000",
    );
    const lines = block
      .slice(timingIndex + 1)
      .map((line) => cleanCueText(line.text))
      .filter(Boolean);
    cues.push({ ...timing, lines });
  }
  const segments = cues
    .map((cue) => ({
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.lines.join(" "),
    }))
    .filter((segment) => segment.text);
  return { format: "srt", segments, hasTimestamps: true, warnings: [] };
}

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:[0-5]\d`;
const TIME_ONLY = new RegExp(String.raw`^\[?(${TIME})\]?$`);
const TIME_THEN_TEXT = new RegExp(
  String.raw`^\[?(${TIME})\]?\s*[-–—:|]?\s+(.+)$`,
);

/** "1:02:03" or "02:03" in milliseconds. */
function clockMs(value: string): number {
  return (
    value.split(":").reduce((total, part) => total * 60 + Number(part), 0) *
    1000
  );
}

function splitLongLine(text: string): string[] {
  if (text.length <= LONG_LINE) return [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of text.split(/(?<=[.!?…。！？])\s+/)) {
    if (current && current.length + sentence.length + 1 > LONG_LINE) {
      parts.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Plain text. Lines that start with a time ("1:23 text"), or a time on its
 * own line before its text (as copied from a transcript panel), are read
 * as timed segments when most lines are like that. Otherwise each line is a
 * segment, with very long lines split at sentence ends.
 */
function parseText(content: string): ParsedTranscript {
  const lines = content
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const timed = lines.filter(
    (line) => TIME_ONLY.test(line) || TIME_THEN_TEXT.test(line),
  ).length;

  if (timed > 0 && timed * 2 >= lines.length) {
    const starts: { startMs: number; text: string[] }[] = [];
    for (const line of lines) {
      const alone = TIME_ONLY.exec(line);
      const inline = alone ? null : TIME_THEN_TEXT.exec(line);
      if (alone?.[1]) {
        starts.push({ startMs: clockMs(alone[1]), text: [] });
      } else if (inline?.[1] && inline[2]) {
        starts.push({ startMs: clockMs(inline[1]), text: [inline[2]] });
      } else if (starts.length > 0) {
        starts.at(-1)?.text.push(line);
      } else {
        starts.push({ startMs: 0, text: [line] });
      }
    }
    const segments = starts
      .map((start, index) => ({
        startMs: start.startMs,
        endMs: starts[index + 1]?.startMs ?? null,
        text: start.text.join(" ").trim(),
      }))
      .filter((segment) => segment.text);
    return {
      format: "text",
      segments,
      hasTimestamps: true,
      warnings: [
        "Times in this file mark where each line starts; each line is taken to last until the next one.",
      ],
    };
  }

  return {
    format: "text",
    segments: lines.flatMap(splitLongLine).map((text) => ({
      startMs: null,
      endMs: null,
      text,
    })),
    hasTimestamps: false,
    warnings: [],
  };
}

export function parseTranscript(
  content: string,
  format: TranscriptFormat,
): ParsedTranscript {
  if (content.includes("\u0000")) {
    throw invalid("This file is not text. Import a .vtt, .srt or .txt file.");
  }
  if (content.trim() === "") throw invalid("The transcript is empty.");
  const parsed =
    format === "webvtt"
      ? parseWebVtt(content)
      : format === "srt"
        ? parseSrt(content)
        : parseText(content);
  if (parsed.segments.length === 0) {
    throw invalid("The file contains no transcript text.");
  }
  if (parsed.segments.length > MAX_SEGMENTS) {
    throw invalid(
      `The transcript has more than ${MAX_SEGMENTS.toLocaleString("en-US")} segments.`,
    );
  }
  if (parsed.hasTimestamps) {
    const outOfOrder = parsed.segments.some(
      (segment, index) =>
        index > 0 &&
        (segment.startMs ?? 0) < (parsed.segments[index - 1]?.startMs ?? 0),
    );
    if (outOfOrder) {
      parsed.warnings.push(
        "Some segments start before the one above them. They were kept in the file's order.",
      );
    }
  }
  return parsed;
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Runs of letters or digits. Not meaningful for languages without spaces. */
export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** From the first start to the last end (or start), when timed. */
export function coveredMs(segments: readonly ParsedSegment[]): number | null {
  const starts = segments
    .map((segment) => segment.startMs)
    .filter((value): value is number => value !== null);
  if (starts.length === 0) return null;
  const ends = segments.map((segment) => segment.endMs ?? segment.startMs ?? 0);
  return Math.max(...ends) - Math.min(...starts);
}
