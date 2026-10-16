# Draw Things integration

[Draw Things](https://drawthings.ai) is an optional engine. Framebop Studio
works without it, and it exists only on macOS and iOS, so it can never be the
only way to produce anything.

This document separates three things that are easy to blur: what Draw Things
offers, what Framebop Studio has implemented against it, and what has actually
been run. Last reviewed in October 2026 against Draw Things 26.1008.0 on
macOS.

## Summary

| Question                                                       | Answer                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Can a running Draw Things app be detected?                     | Yes. Implemented and tested.                                                                                     |
| Can its capabilities be read?                                  | Its current settings can, over HTTP. Its list of installed models cannot.                                        |
| Can an image be generated through its HTTP API?                | The API supports it. An adapter is implemented from the published server source. Not yet run against a live app. |
| Can a video be generated through its HTTP API?                 | **No.** The API's response carries images only. There is no video output.                                        |
| Can LTX-2.3 image-to-video be started programmatically at all? | Per its published source, the official command-line tool can write video. **Not confirmed by running it.**       |
| Does the HTTP API report progress?                             | No.                                                                                                              |
| Can a generation be cancelled through the HTTP API?            | No.                                                                                                              |
| Can a command-line generation be cancelled?                    | Yes, by ending the process. Implemented; tested against a stand-in, not the real tool.                           |

Nothing in this document was established by running a model. No LTX
generation was started while writing the integration.

## Sources

Two, and only two, were treated as authoritative:

1. **The installed application.** Its bundle was inspected read-only: bundle
   identifier `com.liuliu.draw-things`, the `drawthings://` URL scheme, the
   settings labels "API Server", "HTTP" and "gRPC" in its localisation files,
   and the route strings `/sdapi/v1/txt2img`, `/sdapi/v1/img2img` and
   `/sdapi/v1/options` in its executable.
2. **The published source**,
   [drawthingsai/draw-things-community](https://github.com/drawthingsai/draw-things-community)
   (GPL-3.0): `Libraries/HTTPAPIServer` for the HTTP server and
   `Apps/DrawThingsCLI` for the command-line tool.

Community write-ups describe the same features but disagree on details such
as the default port, so nothing was taken from them.

The models folder inside Draw Things' sandbox container was not read.
Framebop Studio must never modify those files, and reading another
application's container triggers a macOS permission prompt, so that has to be
an explicit user action.

## The HTTP API server

Switched on in Draw Things under **API Server**, with the **HTTP** protocol.
It is off by default. From `HTTPAPIServer.swift` and `ServerModels.swift`:

| Route                    | Behaviour                                                                      |
| ------------------------ | ------------------------------------------------------------------------------ |
| `GET /sdapi/v1/options`  | The app's current generation settings as one JSON object. `GET /` is the same. |
| `POST /sdapi/v1/txt2img` | Generates from the posted settings.                                            |
| `POST /sdapi/v1/img2img` | The same, starting from exactly one base64 image in `init_images`.             |

What follows from the source, and how the adapter deals with it:

- **Unknown keys are rejected.** A request containing any key the server does
  not know fails with status 422. The known keys are those `options` returns,
  so the adapter reads `options` first and sends only keys it finds there. It
  never assumes a key exists.
- **Omitted settings keep the app's values.** That includes the model: a
  request runs with whichever model is selected in Draw Things. The adapter
  sends a prompt, a size and a seed, and says in the interface that the model
  and sampler come from the app.
- **The call is synchronous.** The server answers when generation has
  finished and sends nothing before that. There is no job identifier, no
  progress route and no interrupt route. The adapter therefore declares
  `reportsProgress: false` and `supportsCancellation: false`, and the
  interface disables the stop button for it.
- **The response is `{"images": [...]}`.** Base64-encoded image data and
  nothing else. This is why video is not offered through HTTP. Whether a
  video model would return its frames as a list of images is unknown, and
  finding out would mean running one.
- **Errors** arrive as status 422 with a `detail` string, which the adapter
  passes on verbatim.
- For `img2img`, the image's pixel size must equal the requested width and
  height. The adapter does not use `img2img`.

Two engineering consequences worth knowing:

- The adapter uses `node:http`, not `fetch`. `fetch` gives up when response
  headers take more than five minutes, and this server sends none until a
  generation that may take far longer is done.
- The address is fixed to `127.0.0.1`. Only the port is configurable (in
  Settings, default 7860), so a request can never leave the machine.

The default port is not stated in the source. 7860 is what community tools
use; if the app shows a different one, change it in Settings.

## The command-line tool

`draw-things-cli` is a separate program from the app. The repository documents
installing it with
`brew install --HEAD drawthingsai/draw-things/draw-things-cli`. It is not
bundled with Draw Things and was **not installed on the development machine**,
so everything below comes from reading `DrawThingsCLI.swift`.

`draw-things-cli generate` accepts, among others:

| Option                                         | Meaning                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `--model`                                      | Model file, model name or Hugging Face repository                |
| `--prompt`, `--negative-prompt`                | Text                                                             |
| `--width`, `--height`                          | Pixels, multiples of 64                                          |
| `--steps`, `--cfg`, `--seed`, `--strength`     | Sampling settings                                                |
| `--frames`                                     | Frame count "for video-capable models"                           |
| `--image`                                      | Input image; the first is the img2img or reference input         |
| `--output`                                     | `.png` for an image, `.mov` or `.mp4` "for video-capable models" |
| `--video-format`                               | `prores4444`, `prores422hq`, `h264`, `hevc`                      |
| `--offline`                                    | No network access; never downloads models                        |
| `--download-missing` / `--no-download-missing` | Auto-download missing model files. **On by default.**            |
| `--models-dir`                                 | Defaults on macOS to the app's own models folder                 |

So the tool takes a still image and writes a video file, which is exactly the
image-to-video step. The repository also contains LTX-2 model code. That makes
LTX image-to-video through the tool plausible. It does not make it verified:
whether the installed LTX-2.3 model runs this way, and whether the result is
usable, is unknown until someone runs it.

How the adapter uses it:

- **It never downloads.** `--offline` and `--no-download-missing` are passed
  on every run. Without them the tool would fetch a missing model, which can
  be tens of gigabytes.
- **Every value is passed as `--name=value`.** A prompt that begins with a
  dash can then never be read as another option. The tool is started without
  a shell.
- **Cancelling ends the process**, with a polite signal first and a forced
  one five seconds later.
- **Its progress bar is not shown as progress.** For local generation the
  tool computes it as elapsed time divided by an estimated total. That is a
  guess, not a measurement, so the adapter reports no percentage.
- **Success means exit code 0 and a non-empty output file.** The tool's
  printed output is not parsed, only kept for error messages.

Things to expect when it is first tried for real:

- macOS will probably ask whether Framebop Studio may access data from other
  apps, because the tool reads Draw Things' models folder.
- The tool loads the model in its own process. With Draw Things open as well,
  the model is in memory twice. On a 24 GB machine, quit Draw Things first.
- The frame rate belongs to the model. The adapter exposes a frame count, not
  a duration, because it cannot know the rate.

## gRPC

Draw Things also offers a gRPC API server, and the same repository ships a
standalone `gRPCServerCLI`. Framebop Studio does not use gRPC directly: the
request carries its settings as an opaque FlatBuffer, and the schemas are
GPL-3.0 (see [licensing.md](licensing.md)). The command-line tool can itself
act as a gRPC client (`--remote`), which would allow driving a running app
without implementing the protocol. That route is not implemented.

## What a real test showed

One LTX-2.3 22B Distilled (6-bit) image-to-video run was done by hand in the
Draw Things app on the development machine (M4 Pro, 24 GB): about 11 minutes
for 4.84 seconds at 1024×576. The result was visually unsatisfactory and did
not clearly preserve the source image.

This shaped the design more than any API detail:

- No engine is assumed to be the right one. Engines are interchangeable
  adapters, chosen per job.
- An expensive run never starts by itself. The engine refuses to queue one
  without explicit approval, and never restarts one after a crash.
- Results are not forced onto a scene that already has media. They stay with
  their job until the user chooses to use them.
- Importing a clip made elsewhere remains a complete, first-class workflow.

## Verifying the adapters for real

Both adapters are marked **experimental** in the interface until this is done.
Each step is cheap except the last.

HTTP, image generation:

1. In Draw Things, select a small, fast image model and turn on the API
   Server with the HTTP protocol.
2. In Framebop Studio, open Production and choose **Scan again**. Draw Things
   should change from "Installed, not ready" to "Available".
3. Give a scene an image prompt, choose Draw Things in its Generate section,
   and start a job.

Command-line tool:

1. Install `draw-things-cli`.
2. Scan again; "Draw Things CLI" should become available.
3. Generate one image with a small model first, to confirm the options match
   the installed version.
4. Only then, deliberately, try a video model.

If either behaves differently from what is written here, the adapter and this
document are wrong and should be corrected together.
