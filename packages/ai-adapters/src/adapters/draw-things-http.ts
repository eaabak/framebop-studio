/**
 * Draw Things through its built-in HTTP API server.
 *
 * What is known about that server comes from its published source
 * (drawthingsai/draw-things-community, Libraries/HTTPAPIServer) and from the
 * routes present in the installed application. See docs/draw-things.md.
 *
 *   GET  /sdapi/v1/options   the app's current generation settings, as JSON
 *   POST /sdapi/v1/txt2img   generate; the body overrides individual settings
 *   POST /sdapi/v1/img2img   the same, starting from one `init_images` entry
 *
 * Consequences that shape this adapter:
 *
 *  - A request may only contain keys the server knows; any other key is
 *    rejected. The known keys are exactly those returned by `options`, so
 *    they are discovered at run time instead of being assumed.
 *  - Settings that a request leaves out keep the value they have in the app,
 *    including the selected model.
 *  - The server answers only when generation has finished. There is no
 *    progress and no way to cancel.
 *  - The response carries images only. No video file is ever returned, so
 *    this adapter offers image generation and nothing else.
 *
 * The server address is always the loopback interface. Only the port can be
 * configured, so a request can never be sent to another machine.
 */
import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import {
  type AdapterAvailability,
  type AdapterCapabilities,
  AdapterError,
  type ExecutionContext,
  type ImageGenerationAdapter,
  type ImageGenerationRequest,
  type ImageGenerationResult,
} from "../contracts";
import type { HostPlatform } from "../host/platform";

export const DRAW_THINGS_ID = "draw-things";
const APPLICATION = {
  name: "Draw Things",
  macosBundleId: "com.liuliu.draw-things",
} as const;
const LOOPBACK = "127.0.0.1";
const PROBE_TIMEOUT_MS = 1500;
/** An image arrives base64-encoded inside JSON, so replies can be large. */
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;

interface JsonReply {
  status: number;
  body: unknown;
}

/**
 * Sends one JSON request to the local server.
 *
 * Uses `node:http` rather than `fetch` deliberately: `fetch` gives up when
 * response headers take longer than five minutes, and this server sends
 * nothing at all until a generation that may run far longer has finished.
 */
function sendJson(
  port: number,
  method: "GET" | "POST",
  path: string,
  payload: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<JsonReply> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const request = httpRequest(
      {
        host: LOOPBACK,
        port,
        method,
        path,
        signal: options.signal,
        headers: body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }
          : {},
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("The response was too large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch {
            reject(new Error("The server did not answer with JSON."));
          }
        });
        response.on("error", reject);
      },
    );
    if (options.timeoutMs) {
      request.setTimeout(options.timeoutMs, () =>
        request.destroy(new Error("The server did not answer in time.")),
      );
    }
    request.on("error", reject);
    request.end(body ?? undefined);
  });
}

/** The first key of `candidates` that the server lists among its settings. */
function knownKey(
  options: Record<string, unknown>,
  candidates: readonly string[],
): string | null {
  return candidates.find((key) => Object.hasOwn(options, key)) ?? null;
}

function describeFailure(reply: JsonReply): string {
  const detail =
    typeof reply.body === "object" && reply.body !== null
      ? (reply.body as Record<string, unknown>).detail
      : undefined;
  return typeof detail === "string" && detail.length > 0
    ? detail
    : `The server answered with status ${reply.status}.`;
}

function imageExtension(data: Buffer): "png" | "jpg" | null {
  if (data[0] === 0x89 && data.subarray(1, 4).toString("latin1") === "PNG") {
    return "png";
  }
  if (data[0] === 0xff && data[1] === 0xd8) return "jpg";
  return null;
}

export class DrawThingsHttpImageAdapter implements ImageGenerationAdapter {
  readonly id = DRAW_THINGS_ID;
  readonly name = "Draw Things";
  readonly task = "image_generation";
  readonly isTest = false;
  readonly supportedPlatforms = ["macos"] as const;

  constructor(
    private readonly host: HostPlatform,
    /** Read on every use, so a changed setting applies without a restart. */
    private readonly port: () => number,
  ) {}

  private async readOptions(): Promise<Record<string, unknown> | null> {
    try {
      const reply = await sendJson(
        this.port(),
        "GET",
        "/sdapi/v1/options",
        undefined,
        {
          timeoutMs: PROBE_TIMEOUT_MS,
        },
      );
      const isObject =
        reply.status === 200 &&
        typeof reply.body === "object" &&
        reply.body !== null;
      return isObject ? (reply.body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  async detect(): Promise<AdapterAvailability> {
    if (this.host.os !== "macos") {
      return {
        available: false,
        reason: "Draw Things is a macOS application.",
        version: null,
        location: null,
        installed: false,
      };
    }
    const [application, options] = await Promise.all([
      this.host.findApplication(APPLICATION),
      this.readOptions(),
    ]);
    const address = `${LOOPBACK}:${this.port()}`;
    if (options !== null) {
      return {
        available: true,
        reason: null,
        version: application?.version ?? null,
        location: `http://${address}`,
        installed: true,
      };
    }
    return {
      available: false,
      reason: application
        ? `Draw Things is installed, but its API server is not answering on ${address}. Open Draw Things and turn on its API Server with the HTTP protocol.`
        : "Draw Things is not installed.",
      version: application?.version ?? null,
      location: application?.path ?? null,
      installed: application !== null,
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    const options = await this.readOptions();
    const model = typeof options?.model === "string" ? options.model : null;
    // Steps are offered only when the running server lists them; they start
    // at the value set in the app.
    const steps = options === null ? null : knownKey(options, ["steps"]);
    return {
      maturity: "experimental",
      models: [],
      requiresModel: false,
      parameters:
        steps === null
          ? []
          : [
              {
                key: "steps",
                label: "Steps",
                type: "integer",
                defaultValue:
                  typeof options?.[steps] === "number" ? options[steps] : 20,
                min: 1,
                max: 150,
                step: 1,
                description:
                  "Sampling steps, sent to Draw Things. Its sampler and other settings stay as set in the app.",
              },
            ],
      // Draw Things sizes are multiples of 64, so exact 1080p is not offered.
      // 512 × 512 is what Stable Diffusion 1.5 models were trained at.
      resolutions: [
        { width: 512, height: 512 },
        { width: 1024, height: 576 },
        { width: 1344, height: 768 },
        { width: 1920, height: 1088 },
      ],
      requiresPrompt: true,
      requiresInputImage: false,
      // Keys the server does not know are rejected, so these follow its
      // current settings. Without a running server, neither is offered.
      supportsNegativePrompt:
        options !== null && knownKey(options, ["negative_prompt"]) !== null,
      supportsSeed: options !== null && knownKey(options, ["seed"]) !== null,
      outputFormats: ["image/png"],
      supportsCancellation: false,
      reportsProgress: false,
      expensive: true,
      notes: [
        "Experimental: written from Draw Things’ published server source and not yet confirmed against a running copy.",
        model
          ? `Uses the model selected in Draw Things, currently “${model}”, with its sampler and step settings.`
          : "Uses whichever model, sampler and step settings are selected in Draw Things.",
        "Draw Things reports no progress here and cannot be stopped once it has started.",
        "Still images only. Draw Things’ HTTP API does not return video.",
      ],
    };
  }

  async generate(
    request: ImageGenerationRequest,
    context: ExecutionContext,
  ): Promise<ImageGenerationResult> {
    const options = await this.readOptions();
    if (options === null) {
      throw new AdapterError(
        "UNAVAILABLE",
        "Draw Things’ API server stopped answering before the generation could start.",
      );
    }

    const promptKey = knownKey(options, ["prompt"]);
    const widthKey = knownKey(options, ["width"]);
    const heightKey = knownKey(options, ["height"]);
    if (!promptKey || !widthKey || !heightKey) {
      throw new AdapterError(
        "UNSUPPORTED",
        "This version of Draw Things does not accept a prompt and size over its HTTP API.",
      );
    }
    const body: Record<string, unknown> = {
      [promptKey]: request.prompt,
      [widthKey]: request.width,
      [heightKey]: request.height,
    };
    const negativeKey = knownKey(options, ["negative_prompt"]);
    if (negativeKey && request.negativePrompt)
      body[negativeKey] = request.negativePrompt;
    const seedKey = knownKey(options, ["seed"]);
    if (seedKey) body[seedKey] = request.seed;
    const stepsKey = knownKey(options, ["steps"]);
    if (stepsKey && typeof request.parameters.steps === "number") {
      body[stepsKey] = request.parameters.steps;
    }

    context.log("Sending a text-to-image request to Draw Things", {
      keys: Object.keys(body),
    });
    let reply: JsonReply;
    try {
      reply = await sendJson(this.port(), "POST", "/sdapi/v1/txt2img", body, {
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) {
        throw new AdapterError(
          "CANCELLED",
          "The connection to Draw Things was closed. Draw Things itself may still be generating.",
        );
      }
      throw new AdapterError(
        "ENGINE_FAILURE",
        `Draw Things did not complete the request: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (reply.status !== 200) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        `Draw Things refused the request: ${describeFailure(reply)}`,
      );
    }

    const images = (reply.body as { images?: unknown }).images;
    const first = Array.isArray(images) ? images[0] : undefined;
    if (typeof first !== "string") {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "Draw Things returned no image.",
      );
    }
    const data = Buffer.from(first, "base64");
    const extension = imageExtension(data);
    if (extension === null) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "Draw Things returned data that is not a PNG or JPEG image.",
      );
    }
    const path = join(context.outputDirectory, `draw-things.${extension}`);
    await writeFile(path, data);
    return {
      artifact: { path, kind: "image" },
      model: typeof options.model === "string" ? options.model : null,
      details: { imagesReturned: Array.isArray(images) ? images.length : 0 },
    };
  }
}
