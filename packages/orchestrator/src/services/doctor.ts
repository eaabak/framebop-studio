/**
 * Scene Doctor: inspections of finished videos, as background jobs.
 *
 * The video is only ever read: by FFprobe for its streams, by one FFmpeg
 * pass that runs the detectors (see doctor/analyze.ts), and by FFmpeg again
 * for a bounded number of evidence pictures. Those pictures and the report
 * are the only things written, under media/inspections and in the library's
 * database. Deleting a report never touches the video.
 */
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { runCommand } from "@framebop/ai-adapters";
import {
  AppError,
  type DoctorExport,
  DoctorThresholdsSchema,
  type Inspection,
  type InspectionIssue,
  type Job,
  RenderPlanSchema,
  type RpcParsedParams,
  mediaFormatFor,
  extensionOf,
} from "@framebop/core";
import { z } from "zod";
import type { EngineContext } from "../context";
import {
  AnalysisLog,
  type Probe,
  type Timeline,
  judge,
  timelineFromPlan,
} from "../doctor/analyze";
import { streamCommand } from "../doctor/stream";
import { assertContentMatchesExtension } from "../media/inspect";
import type { JobControl, JobExecutor, JobQueue, JobResult } from "./jobs";

/** At most this many evidence pictures per report, the most severe first. */
const MAX_FRAMES = 40;

const InspectionInputSchema = z.object({
  inspectionId: z.string(),
  /** The timeline of a Framebop export, captured when it was queued. */
  timeline: z.unknown().nullable(),
});

function folderOf(ctx: EngineContext, id: string): string {
  return join(ctx.paths.mediaRoot, "inspections", id);
}

/** Streams, sizes and rates as FFprobe reports them. */
async function probe(ffprobe: string, path: string): Promise<Probe | null> {
  const result = await runCommand(
    ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { timeoutMs: 60_000 },
  );
  if (!result.ok) return null;
  let report: {
    streams?: Record<string, unknown>[];
    format?: Record<string, unknown>;
  };
  try {
    report = JSON.parse(result.stdout) as typeof report;
  } catch {
    return null;
  }
  const streams = report.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const number = (value: unknown) => {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const rate = (value: unknown) => {
    const match = /^(\d+)\/(\d+)$/.exec(String(value ?? ""));
    return match && Number(match[2]) > 0
      ? Number(match[1]) / Number(match[2])
      : null;
  };
  if (!video) return null;
  return {
    durationSeconds: number(report.format?.duration),
    videoDurationSeconds: number(video.duration),
    audioDurationSeconds: audio ? number(audio.duration) : null,
    width: Number(video.width) || null,
    height: Number(video.height) || null,
    fps: rate(video.avg_frame_rate),
    nominalFps: rate(video.r_frame_rate),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : null,
    audioCodec:
      audio && typeof audio.codec_name === "string" ? audio.codec_name : null,
  };
}

export class DoctorService {
  constructor(
    private readonly ctx: EngineContext,
    private readonly queue: JobQueue,
  ) {
    // An inspection cut off by the application closing has no report.
    ctx.db.inspections.markRunningAsInterrupted(ctx.now());
  }

  exports(): DoctorExport[] {
    return this.ctx.db.inspections.exports();
  }

  list(): Inspection[] {
    return this.ctx.db.inspections.list();
  }

  get(id: string): Inspection {
    const found = this.ctx.db.inspections.get(id);
    if (!found)
      throw new AppError("NOT_FOUND", "That report no longer exists.");
    return found;
  }

  async inspect(
    request: RpcParsedParams<"doctor.inspect">,
  ): Promise<Inspection> {
    const { db } = this.ctx;
    let path: string;
    let renderId: string | null = null;
    let projectId: string | null = null;
    let episodeId: string | null = null;
    let timeline: Timeline | null = null;
    let sceneTitles = new Map<string, string>();

    if (request.source.kind === "export") {
      const render = db.renders.get(request.source.renderId);
      if (!render)
        throw new AppError("NOT_FOUND", "That export is no longer listed.");
      path = render.path;
      renderId = render.id;
      episodeId = render.episodeId;
      projectId = db.episodes.get(render.episodeId)?.projectId ?? null;
      // The plan it was rendered from, if its job is still kept.
      const job = render.jobId ? db.jobs.get(render.jobId) : null;
      const plan = RenderPlanSchema.safeParse(job?.input.plan);
      if (plan.success) {
        timeline = timelineFromPlan(plan.data);
        sceneTitles = new Map(
          plan.data.scenes.map((scene) => [
            scene.sceneId,
            db.scenes.get(scene.sceneId)?.title ?? "",
          ]),
        );
      }
    } else {
      if (!isAbsolute(request.source.path)) {
        throw new AppError(
          "VALIDATION",
          "Choose a video file on this computer.",
        );
      }
      path = request.source.path;
    }

    // Only a real video file, of a kind that can be decoded, is read.
    const real = await realpath(path).catch(() => null);
    const info = real ? await stat(real).catch(() => null) : null;
    if (!real || !info?.isFile() || info.size === 0) {
      throw new AppError("NOT_FOUND", "The video file is missing or empty.");
    }
    if (mediaFormatFor(real)?.kind !== "video") {
      throw new AppError(
        "VALIDATION",
        "That is not a video file Framebop can read.",
      );
    }
    await assertContentMatchesExtension(real, extensionOf(real));

    const now = this.ctx.now();
    const inspection: Inspection = {
      id: this.ctx.newId(),
      jobId: null,
      name: basename(real),
      source: {
        kind: request.source.kind,
        path: real,
        renderId,
        projectId,
        episodeId,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      },
      thresholds: request.thresholds ?? DoctorThresholdsSchema.parse({}),
      status: "pending",
      error: null,
      overview: null,
      scenes: timeline
        ? timeline.scenes.map((scene) => ({
            sceneId: scene.sceneId,
            index: scene.index,
            title: sceneTitles.get(scene.sceneId) ?? "",
            start: scene.start,
            end: scene.end,
          }))
        : [],
      issues: [],
      createdAt: now,
      finishedAt: null,
    };
    db.inspections.put(inspection);
    const job = this.queue.submit({
      type: "video_inspection",
      label: `Inspect ${inspection.name}`,
      adapterId: null,
      model: null,
      projectId,
      episodeId,
      sceneId: null,
      slot: null,
      input: { inspectionId: inspection.id, timeline },
    });
    const queued = { ...inspection, jobId: job.id };
    db.inspections.put(queued);
    return queued;
  }

  async delete(id: string): Promise<void> {
    const found = this.get(id);
    if (found.status === "pending" || found.status === "running") {
      throw new AppError(
        "CONFLICT",
        "Stop the inspection before deleting its report.",
      );
    }
    await rm(folderOf(this.ctx, id), { recursive: true, force: true });
    this.ctx.db.inspections.delete(id);
  }

  executor(): JobExecutor {
    const ctx = this.ctx;

    async function run(job: Job, control: JobControl): Promise<JobResult> {
      const input = InspectionInputSchema.parse(job.input);
      const inspection = ctx.db.inspections.get(input.inspectionId);
      if (!inspection)
        throw new AppError("NOT_FOUND", "The report was deleted.");
      const timeline = (input.timeline as Timeline | null) ?? null;
      const folder = folderOf(ctx, inspection.id);
      ctx.db.inspections.put({ ...inspection, status: "running" });

      try {
        const { ffmpeg, ffprobe } = ctx.tools;
        if (!ffmpeg.path || !ffprobe.path) {
          throw new AppError(
            "UNAVAILABLE",
            "FFmpeg is needed to inspect a video.",
          );
        }
        control.setStage("preflight");
        // The file must still be the one that was chosen.
        const info = await stat(inspection.source.path).catch(() => null);
        if (!info?.isFile()) {
          throw new AppError("NOT_FOUND", "The video file is no longer there.");
        }
        const streams = await probe(ffprobe.path, inspection.source.path);
        if (!streams) {
          const issue: InspectionIssue = {
            id: "unreadable",
            type: "unreadable",
            severity: "critical",
            intent: "defect",
            start: null,
            end: null,
            approximateTime: false,
            measured: {},
            context: null,
            frames: [],
            log: [],
            sceneId: null,
            sceneIndex: null,
            shotIndex: null,
          };
          const done = {
            ...inspection,
            status: "completed" as const,
            issues: [issue],
            finishedAt: ctx.now(),
          };
          ctx.db.inspections.put(done);
          return { output: { issues: 1 } };
        }

        control.setStage("analyzing");
        const { thresholds } = inspection;
        const log = new AnalysisLog(thresholds.clippingDbfs);
        const duration =
          streams.durationSeconds ?? streams.videoDurationSeconds ?? 0;
        const audio = streams.audioCodec !== null;
        const result = await streamCommand(
          ffmpeg.path,
          [
            "-hide_banner",
            "-nostats",
            "-v",
            "info",
            "-progress",
            "pipe:1",
            "-i",
            inspection.source.path,
            "-map",
            "0:v:0",
            ...(audio ? ["-map", "0:a:0"] : []),
            "-vf",
            `blackdetect=d=${thresholds.black.minSeconds}:pic_th=${thresholds.black.pictureRatio}:pix_th=${thresholds.black.pixelThreshold},freezedetect=n=${thresholds.freeze.noiseDb}dB:d=${thresholds.freeze.minSeconds}`,
            ...(audio
              ? [
                  "-af",
                  `silencedetect=n=${thresholds.silence.noiseDb}dB:d=${thresholds.silence.minSeconds},aresample=48000,asetnsamples=n=4800:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level`,
                  // Kept in floating point: a 16-bit output would clamp
                  // every peak at 0 dBFS and hide how far it went over.
                  "-c:a",
                  "pcm_f32le",
                ]
              : []),
            "-f",
            "null",
            "-",
          ],
          {
            signal: control.signal,
            onStdout: (line) => {
              log.progress(line);
              if (line.startsWith("out_time_us=") && duration > 0) {
                control.reportProgress(Math.min(1, log.time / duration), null);
              }
            },
            onStderr: (line) => log.log(line),
          },
        );
        // A file that stops decoding part-way still has findings to show.
        if (result.exitCode !== 0 && log.decodeErrorCount === 0) {
          log.decodeErrorCount = 1;
          log.decodeErrors.push({
            at: log.time,
            line: result.tail.at(-1) ?? "",
          });
        }
        log.finish(duration);
        const issues = judge({ probe: streams, log, timeline, thresholds });

        // Pictures from the video itself, for the findings that show on it.
        control.setStage("extracting");
        await rm(folder, { recursive: true, force: true });
        await mkdir(folder, { recursive: true });
        let taken = 0;
        for (const issue of issues) {
          if (taken >= MAX_FRAMES) break;
          if (issue.start === null || issue.end === null) continue;
          control.signal.throwIfAborted();
          const at = Math.max(
            0,
            Math.min(duration - 0.05, (issue.start + issue.end) / 2),
          );
          const file = `frame-${taken + 1}.jpg`;
          const made = await runCommand(
            ffmpeg.path,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-y",
              "-ss",
              at.toFixed(3),
              "-i",
              inspection.source.path,
              "-frames:v",
              "1",
              "-vf",
              "scale='min(480,iw)':-2",
              "-q:v",
              "4",
              join(folder, file),
            ],
            { timeoutMs: 30_000, signal: control.signal },
          );
          if (made.ok) {
            issue.frames.push({
              at,
              file: `inspections/${inspection.id}/${file}`,
            });
            taken += 1;
          }
          control.reportProgress(
            taken / Math.min(MAX_FRAMES, issues.length),
            null,
          );
        }

        const done: Inspection = {
          ...inspection,
          status: "completed",
          overview: {
            durationSeconds: streams.durationSeconds,
            width: streams.width,
            height: streams.height,
            fps: streams.fps,
            videoCodec: streams.videoCodec,
            audioCodec: streams.audioCodec,
            audioDurationSeconds: streams.audioDurationSeconds,
            framesDecoded: log.framesDecoded,
            timeline: timeline !== null,
          },
          issues,
          finishedAt: ctx.now(),
        };
        ctx.db.inspections.put(done);
        return {
          output: { issues: issues.length },
          metadata: { frames: taken },
        };
      } catch (error) {
        await rm(folder, { recursive: true, force: true });
        const cancelled = control.signal.aborted;
        ctx.db.inspections.put({
          ...inspection,
          status: cancelled ? "cancelled" : "failed",
          error: cancelled
            ? null
            : error instanceof Error
              ? error.message
              : String(error),
          finishedAt: ctx.now(),
        });
        if (cancelled) {
          throw new AppError("CANCELLED", "The inspection was stopped.");
        }
        throw error;
      }
    }

    return { canCancel: () => true, run };
  }
}
