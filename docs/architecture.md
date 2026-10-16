# Architecture

This document explains how Framebop Studio is put together and why. It
describes the code as it exists; planned work is marked as such.

## Processes

The running application is two processes.

```
┌──────────────────────────────────────────────┐
│ Desktop shell (Rust, Tauri 2)                │
│  ┌────────────────────────────────────────┐  │
│  │ Webview: the interface (React)         │  │
│  └───────────────┬────────────────────────┘  │
│                  │ Tauri IPC                 │
│  ┌───────────────▼────────────────────────┐  │
│  │ Engine supervisor (src-tauri/engine.rs)│  │
│  └───────────────┬────────────────────────┘  │
└──────────────────┼───────────────────────────┘
                   │ stdin / stdout, one JSON object per line
┌──────────────────▼───────────────────────────┐
│ Engine (Node.js, packages/orchestrator)      │
│  services · job runner · SQLite · media I/O  │
└──────────────────────────────────────────────┘
```

**The shell** owns the window and nothing else of substance. It starts the
engine, forwards calls from the interface to it, forwards its events back, and
restarts or reports it if it dies. It is about 350 lines of Rust.

**The engine** holds all application logic: the library, validation, media
import, background jobs, and in future the generation adapters. It has no
dependency on the shell or on any interface, which is what makes it testable
in isolation and usable from other front ends.

**The interface** renders state and sends intent. It never touches the
filesystem or the database.

### Engine lifecycle

The shell starts the engine at launch and asks it to stop when the app quits,
waiting up to two seconds before killing it. If the engine exits unexpectedly
the interface shows a banner with a restart button, and calls in flight fail
with `UNAVAILABLE`.

The engine also protects itself against being orphaned. If the shell crashes
or is force-quit, the engine's stdin closes; it then finishes what it can and
exits, with a three-second deadline. Its handling of the closed pipes matters:
writing to a pipe whose reader is gone raises an error, and an error handler
that logs to the same pipe would loop forever.

### Why a separate engine process

- Generation jobs will run for minutes and use a lot of memory. Keeping them
  out of the window process keeps the interface responsive and lets the engine
  be restarted without losing the window.
- The logic is TypeScript, shared by every platform, rather than Rust that
  only Tauri can call.
- The same engine can later serve a command-line tool or a headless render.

### Why Node.js and not Rust

Most of the ecosystem this project integrates with (Remotion, model tooling,
HTTP and gRPC clients) is JavaScript or has first-class JavaScript bindings.
Rust is used only where Tauri requires it.

## Packages

| Package                   | Runs in           | Responsibility                                                    |
| ------------------------- | ----------------- | ----------------------------------------------------------------- |
| `@framebop/core`          | Engine and UI     | Data schemas (Zod), the RPC contract, pure helpers. No I/O.       |
| `@framebop/database`      | Engine            | SQLite connection, migrations, repositories.                      |
| `@framebop/ai-adapters`   | Engine            | Adapter contracts, adapter registry, host and engine detection.   |
| `@framebop/model-manager` | Engine            | Model catalog, verified downloads, storage, external discovery.   |
| `@framebop/renderer`      | Engine and worker | Render plan, Remotion composition, the render worker process.     |
| `@framebop/research`      | Engine            | YouTube Data API client, transcript parsing, rule-based analysis. |
| `@framebop/orchestrator`  | Engine            | Services, job runner, transports, process entry point.            |
| `@framebop/desktop`       | Webview and shell | React interface and the Tauri shell.                              |

Packages are consumed as TypeScript source inside the workspace. Only two
artefacts are built: the engine bundle (`packages/orchestrator/dist/worker.mjs`,
a single file made with esbuild) and the interface (`apps/desktop/dist`).

Rendering adds two more artefacts, built by `pnpm --filter @framebop/renderer
build`: the render worker (`packages/renderer/dist/render-worker.mjs`) and the
bundled composition (`packages/renderer/dist/site`). Unlike the engine, the
worker keeps `@remotion/renderer` as an external dependency, because Remotion
finds its native compositor binary at run time.

## The interface ↔ engine contract

`packages/core/src/rpc.ts` lists every method the interface may call, with a
Zod schema for its parameters and its result. It is the single source of truth
for both sides:

- the engine validates parameters against it before any handler runs, and
  rejects unknown methods and unknown parameters;
- the interface gets its call signatures from it, so a mismatch is a compile
  error;
- the test suites parse every result against it.

Calls are request and response. Anything that takes time returns at once and
reports progress through events: media imports and production runs as jobs
(`job.updated`, `scene.updated`), model downloads as installations
(`model.updated`, `model.removed`), and `log` for the activity panel.

Errors cross the boundary as `{ code, message }`. Codes are a fixed list in
`packages/core/src/errors.ts`. Unexpected exceptions become `INTERNAL` and are
logged with a stack trace.

## Data

### Library layout

```
<data dir>/
  framebop.db                       SQLite database (WAL mode)
  media/<project id>/<asset id>.ext managed copies of imported media
  media/<project id>/thumbs/        generated thumbnails
  work/<job id>/                    scratch folder of a running job
  engine.lock                       held while an engine has the library open
  framebop.db.before-schema-N.backup  snapshot taken before a schema upgrade
  logs/engine.log                   engine log, rotated at 5 MB
  exports/                          finished videos (unless another folder is chosen)
  models/<installation id>/         a downloaded model (unless moved elsewhere)
    .framebop-model.json            ownership marker and file manifest
    <file>.part                     a file still being downloaded
```

Paths stored in the database are relative to `media/` and use forward slashes
on every platform, so a library can be moved between machines and operating
systems.

### Schema

`projects → episodes → scenes`, with `assets` owned by a project and referenced
from a scene's image, video and audio slots. `jobs` records background work.
`settings` is a key and value table. The model manager adds `model_catalog`
(the catalog definitions the installations refer to), `model_installations`
(at most one per model), `model_sources` (folders added for discovery) and
`external_models` (what the last scan of each source found). Rendering adds a
transition and an overlay to each scene, background music and its volume to
each episode, and `renders`, the exported videos with the results of their
checks. Video DNA Lab adds `research_projects → reference_videos`, and for
each video `metadata_snapshots`, one `comment_samples` row with its
`comments`, `transcripts` with their `transcript_segments`, and
`research_findings` with their `evidence_references`. The Production
Blueprint adds `scene_plans`, one per scene, which also hold the animation a
layered-2d scene is drawn from. See `packages/database/src/migrations.ts`.

Migrations are forward-only and append-only. Before an existing library is
upgraded, a snapshot of its database is written next to it. A library last written by a newer
schema than the running build is refused, rather than risk corrupting it.

### SQLite driver

The engine uses Node's built-in `node:sqlite` module instead of a native addon
such as `better-sqlite3`. A native addon would have to be compiled for every
platform and architecture and shipped next to the engine bundle; the built-in
module needs neither. `node:sqlite` is still marked experimental in Node 22,
which is acceptable here because the application ships its own pinned Node.js
runtime, so the API cannot change underneath an installed copy. All access goes
through one class (`packages/database/src/connection.ts`) to keep a driver
change contained.

### Media import

Importing copies the file into the library. It does not move or link it.

1. The request is checked: absolute path, supported extension, right kind of
   file for the slot.
2. The file's first bytes are checked against its extension.
3. It is copied to a temporary name while a SHA-256 is computed, with progress
   reported from bytes written.
4. If the same content already exists in the project, the copy is discarded
   and the existing asset is reused.
5. Otherwise the copy is renamed into place, then measured with `ffprobe` and
   given a thumbnail with `ffmpeg` when those tools are present.
6. The asset is attached to the scene in one transaction.

FFmpeg is optional. When it is absent, the interface reports the dimensions
and duration it reads from the media element the first time a file is
previewed (`assets.reportMetadata`). The engine only fills fields that are
still empty, so a value measured by `ffprobe` is never overwritten.

Copies that no scene references any more are deleted. Unfinished copies left
by a crash are removed at the next start.

### Production jobs

A job is a row in the `jobs` table. Its kinds are `media_import`,
`image_generation`, `video_generation`, `audio_generation` and `video_render`;
its states are:

| State         | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `pending`     | Waiting for its turn. Nothing has started.                  |
| `running`     | An executor is working on it now.                           |
| `completed`   | Finished and produced its output.                           |
| `failed`      | Stopped with an error, which is recorded.                   |
| `cancelled`   | Stopped because the user asked.                             |
| `interrupted` | Was running when the application stopped. Its work is lost. |

**SQLite is the queue.** Waiting jobs are the rows with state `pending`.
Starting one is a single transaction that flips the oldest to `running`, so a
job cannot be started twice. Nothing about a job lives only in memory, which is
why the history and everything still waiting survive a restart or a crash
(`packages/orchestrator/src/services/jobs.ts`).

**Two lanes.** Production work loads models and can occupy most of the
machine's memory for minutes, so it runs strictly one job at a time. Importing
a file is cheap disk work and has its own lane (two at a time), so bringing in
finished media never waits behind a long generation.

**No duplicate work.** A scene slot can have at most one waiting or running
job of a kind. The queue checks this, and a partial unique index in the
database makes it impossible to violate.

**Progress is measured or absent.** An executor reports a fraction that it
measured, or `null`. Elapsed time is shown as elapsed time and is never turned
into a percentage.

**Cancelling** a waiting job removes it at once. Cancelling a running job
asks its executor to stop, and the state changes when it actually has. If the
engine behind a job cannot be stopped, the request is refused and the
interface says so, rather than pretending.

**Retrying** a failed, cancelled or interrupted job creates a new job with
the same input and the next attempt number. The earlier job stays in the
history.

#### Restarts and crashes

What survives a stop is the record, not the work. On start
(`JobQueue.recover`):

- A job found `running` belonged to a process that no longer exists. It is
  marked `interrupted` and is **never restarted automatically**: its engine
  may have been minutes into an expensive run, and running it again is the
  user's decision.
- If production jobs are still `pending`, the production lane starts **on
  hold**. Nothing runs until the user resumes the queue. The hold is stored,
  so it survives further restarts.
- Waiting imports resume by themselves, because repeating them is harmless.
- Scratch folders and half-written copies from the old process are removed.

Because recovery declares every running job dead, two engines must never open
the same library. A lock file holding the owner's process id enforces this
(`lock.ts`); a lock whose owner no longer exists is stale and is taken over.

#### Results

An engine writes its output into a scratch folder created for that job, the
only place it may write. The engine then checks that the file really is inside
that folder, is of the kind the job was for, and contains what its extension
claims, before moving it into the library as an asset with origin `generated`.

The result goes straight into the scene only if the slot is empty. If the
scene already has media there, the result stays with its job and the user
chooses whether to use it. Results kept this way are removed when the job
history is cleared.

## Engine adapters

`packages/ai-adapters/src/contracts.ts` defines what a production backend
implements. Every adapter has an identity, a task, `detect()` and
`getCapabilities()`; a generation adapter adds `generate(request, context)`.
The `ExecutionContext` gives it a cancellation signal, a way to report
progress, its scratch folder and the attempt number.

Two rules hold for every adapter:

1. **Describe, do not assume.** An adapter states whether it can be cancelled,
   whether it reports progress, whether a run is expensive, what it needs as
   input, and how far it has been verified. The engine and the interface act
   on those statements.
2. **Report only what is real.** No estimated progress, no capabilities that
   were not confirmed.

The production engine depends only on these interfaces and on the
`AdapterRegistry`. The one place that names concrete backends is
`default-registry.ts`.

Adapters in this build:

| Adapter            | Tasks        | State                                                                                  |
| ------------------ | ------------ | -------------------------------------------------------------------------------------- |
| Test pattern       | Image, video | Works. Draws a test pattern, runs no model. Labelled as a test everywhere.             |
| Draw Things (HTTP) | Image        | Experimental. Written from the published server source; not run against a live app.    |
| Draw Things CLI    | Image, video | Experimental. Written from the published tool source; the tool has not been installed. |

See [draw-things.md](draw-things.md) for what each Draw Things route can and
cannot do. ComfyUI, an MLX runtime, Kokoro and a renderer are planned and have
no code.

**Expensive runs need consent.** An adapter that declares `expensive` cannot
be queued without `approvedExpensive: true`. This is enforced in the engine,
not only in the interface, so no caller can start one by accident.

**The test adapter** is what makes the production engine testable without a
GPU. It works through a chosen number of timed steps, reports each as it
completes, can be told to fail (always, or only on the first attempt), stops
when cancelled, and writes a real PNG using a small built-in encoder, or a
real MP4 when FFmpeg is present. It is deterministic: the same request gives
the same image.

## Model manager

`packages/model-manager` holds the parts that do not depend on the engine:
the catalog, the downloader, hashing, storage rules and discovery.
`packages/orchestrator/src/services/models.ts` ties them to the database,
the adapters and the interface. [models.md](models.md) describes the behaviour
from the user's side.

**Registry.** The models on offer come from a versioned JSON manifest
(`registry/framebop-registry.json`, `registry.ts`; format in
[registry.md](registry.md)), validated with Zod. Each entry names a Hugging
Face repository and a full 40-character commit, and lists only the files that
variant needs, each with its size and a hash: the SHA-256 for files stored in
Git LFS, the Git blob id for small files that are not. Licence, access,
hardware requirements, presets and real test runs are recorded with it.
Nothing in an entry is estimated: a requirement the publisher does not state
is `null`, and the interface shows it as unknown.

The copy that ships with the app is the fallback. A newer one can be fetched
on request from the address in settings (`registry.refresh`): https only
(loopback http for testing), no credentials, at most 2 MB, every redirect
checked, and validated before anything changes. It is used only while it is
newer than the shipped one, and is kept in `registry_cache` so it survives
restarts and works offline. Models the user adds from Hugging Face are kept
in `imported_models` and appended. Entries an installation refers to stay in
`model_catalog` even when a registry drops them.

**Hugging Face as a source** (`community.ts`). Search uses
`GET /api/models?search=&pipeline_tag=&sort=&limit=` and follows the cursor
in the `Link` header; a repository's details use `GET /api/models/{repo}?blobs=true`.
Neither downloads weights. Rate limiting (HTTP 429, with the reset time from
the `ratelimit` header), refusals and being offline are reported in words. A
repository is matched against _recipes_: file layouts that an engine in this
build loads. Only a match, not gated and with sizes and hashes for every
needed file, can be added, as an entry pinned to the inspected commit with
only the recipe's files. Nothing from a repository is executed; the only
recipe today loads PyTorch weights with `torch.load(weights_only=True)`,
which refuses pickled code.

**Separate answers.** Installed (files present and verified), compatible
(stated requirements met by the detected hardware, or a recorded run on the
same OS and architecture, `compatibility.ts`) and runnable (an available
adapter accepts it) are computed independently. An adapter that loads model
files implements `evaluateModel(candidate)` and explains its answer, and says
whether a refusal is `runtime-missing` (it could run this once its runtime is
set up) or `unsupported` (never). Adapters for the model's own task are asked
first, so the explanation comes from the relevant engine. For a model that is
not installed, adapters are asked about the installation it would have, so the
download dialog can say in advance whether it would be usable.

`galleryStatusOf` (core, pure, tested) folds these into the one status a
gallery card shows, in a fixed order of precedence: downloading, verification
failed, ready, installed but runtime missing, external, unsupported,
insufficient, compatible, unknown. "Ready" requires an engine that accepts
the files now.

**Presets** belong to a registry entry, an engine and a task. `applyPreset`
(core) checks each value against the engine's own parameter specs and output
sizes and returns what it could not apply, which the Generate section shows.

**Downloading** (`hub.ts`, `download.ts`). Only after the user approves, which
the engine checks (`approved: true` is part of the call's schema):

1. Free space is checked against the remaining bytes plus a margin.
2. The pinned commit's metadata is fetched from the Hugging Face API
   (`/api/models/<repo>/revision/<commit>?blobs=true`). If a file is missing
   or its size or hash differs from the catalog, nothing is downloaded.
3. Each file is streamed from `/<repo>/resolve/<commit>/<path>` to
   `<file>.part`, hashed as it arrives, with backpressure so memory use stays
   flat at any file size. Progress events carry bytes actually written,
   throttled to four a second.
4. A `.part` file is renamed to its final name only when its size and hash
   match. A mismatch deletes it and fails the installation with `INTEGRITY`.
5. The ownership marker is written, and the installation becomes `installed`
   and `verified`.

Downloads run one at a time. A dropped connection keeps the partial file. The
next attempt hashes what is on disk and asks only for the rest with an HTTP
range request; if the server answers with the whole file instead, it starts
over cleanly. A file that is already complete is re-hashed rather than
downloaded again.

The official `@huggingface/hub` package was evaluated for downloads and not
used: its download helpers report no progress, do not resume with range
requests and do not verify hashes. The two REST endpoints above are public and
stable, so the downloader calls them directly.

**Crashes and restarts.** As with jobs, the record survives and the work does
not restart by itself. A download left `queued`, `downloading` or `verifying`
is marked `interrupted` at the next start. Its partial files stay on disk, and
resuming it continues from them.

**Ownership and removal** (`storage.ts`). Framebop only ever deletes files it
created. Removal requires the installation's folder to be exactly
`<storage root>/<installation id>`, with a marker naming that installation,
and then deletes only the files in the catalog's manifest and their `.part`
files. It never follows symbolic links and removes a folder only when it is
empty, so anything else found there is left in place and logged. Every
relative path is checked to stay inside the installation folder.

**External models** (`discovery.ts`). Only folders the user adds are scanned;
the disk is never searched. A scan lists files with a known model extension of
at least 1 MB, up to four levels deep and 20,000 entries, and skips hidden
entries and symbolic links. A Hugging Face cache is read through its
`models--owner--name/snapshots/<commit>` layout, following its links only
within the cache. A file is matched to a catalog entry only when that can be
told for certain: the same repository, commit and file sizes in a cache, or
the same file name and size in a folder. External files are never written,
moved or deleted, and removing a source only forgets its scan results. A
folder that is, or contains, Framebop's own model storage is refused as a
source.

Known model folders of other applications (`knownModelFolders()` on the
platform host; today only Draw Things' container folder on macOS) are offered
as one-click sources when they are not added yet. They are only suggested:
nothing there is read until the user adds the folder, and it is then scanned
like any other, read only.

**Storage location.** New installations go to `settings.modelsDirectory`, or
`<data dir>/models` when it is unset. A custom location must be an absolute,
existing, writable directory that is not a symbolic link or a drive root. It
cannot be changed while a download runs, and existing installations keep
their recorded folders.

**Hardware inventory** (`packages/ai-adapters/src/host/inventory.ts`). Values
come from the operating system's own tools, parsed by pure functions that are
tested against recorded output:

| Platform | Source                                                    |
| -------- | --------------------------------------------------------- |
| All      | `nvidia-smi` for NVIDIA GPUs and their memory, if present |
| macOS    | `system_profiler SPDisplaysDataType -json`, `sw_vers`     |
| Windows  | PowerShell `Get-CimInstance Win32_VideoController`        |
| Linux    | `lspci -mm`; `rocm-smi` presence for ROCm                 |

Apple Silicon GPUs share system memory, so no separate video memory figure is
reported or invented. The `AdapterRAM` value Windows reports is not used,
because it is a 32-bit field that is wrong for cards with more than 4 GB.
Anything that could not be determined is listed with the reason. Only the
macOS path has run on real hardware.

**The model picker** (`models.choices`). For one engine and task, the engine
lists what the engine offers itself, verified installations, every file found
in added folders, and catalog models still to download, each evaluated by the
adapter with a reason and the `reference` to send as the job's model. Entries
it cannot use are returned too, so the interface can say why rather than hide
them. A generation job may name a file by absolute path only if that path is
the reference of a usable entry for that engine; anything else is refused.

The picker also returns the entry's presets, and the gallery's "Use in a
scene" opens the Generate section with the task, engine and model already
chosen, through the same picker.

**Not done:** gated models (they are listed but refused, because access tokens
would need secure storage), a hosted registry, Hugging Face recipes beyond
Kokoro's PyTorch layout, a model runtime of Framebop's own, and reading an
engine's own model list (Draw Things does not publish its list over HTTP; its
models folder can be added as a read-only source instead).

## Rendering

Rendering turns an episode into an MP4 in three steps: plan, render, check.

**The plan** (`packages/renderer/src/plan.ts`) is a pure function from the
episode's scenes and their measured media to whole frames: where each scene
starts and how long it lasts, what it shows, every narration and music clip,
every caption. It is deterministic, so the same edit always gives the same
video (three renders of the test episode were byte-identical), and it is
where all timing rules live:

- A scene lasts its duration, rounded to the nearest frame.
- Narration starts 0.25 s into its scene and is never cut: a scene too short
  for it is lengthened so that 0.5 s remain after it, and the plan says so.
  Shorter narration is followed by silence. Lengths are the measured lengths
  of the files: ffprobe at import, or the WAV header without FFmpeg.
- A fade overlaps a scene with the end of the previous one for at most 0.5 s
  and never more than half of either. Because the lead-in and tail around
  narration are longer than any fade, two narrations can never overlap; the
  tests check this for every frame rate offered.
- A clip shorter than its scene holds its last frame; a longer one is cut.
- Music loops under the whole video with a short fade in and out.
- Captions, when chosen, show each scene's narration text, sentence by
  sentence, each for a share of the narration proportional to its length.
  They are labelled approximate everywhere. Word-level timing is not
  invented.

Problems the user must fix (missing files, unknown lengths, an empty scene)
are errors that stop the render; changes the plan makes on its own (a
lengthened scene, a held frame, a camera move a still cannot do) are
warnings. Both are shown in the Export tab before rendering.

**The render** runs as a `video_render` job in the production lane, so it
waits for other production work and survives restarts like any job. When it
starts, the job checks that every file is still there, unchanged in size and
of the type its name says, and then hands the plan to the render adapter
(`packages/ai-adapters/src/adapters/remotion.ts`). The adapter starts the
render worker as a separate Node.js process and relays its messages:

- The worker serves exactly the plan's files from a server on `127.0.0.1`,
  under a random path, so the headless browser can load them and nothing
  else.
- It renders the bundled composition with Remotion: H.264, AAC, `yuv420p`,
  at most four frames in parallel and a bounded video cache.
- It reports rendered and encoded frames as they happen. That is the
  progress shown, and it is measured, not estimated.
- Cancelling sends a stop message, and ends the process if it has not
  stopped five seconds later. Closing its input (the engine going away) also
  stops it.

**The check** (`packages/orchestrator/src/media/validate.ts`) runs before
anything is reported as done. ffprobe gives duration, size, frame rate and
codecs, compared against the plan. One FFmpeg pass then decodes every frame
and sample, which proves the file can be read, and on the way measures black
picture and loudness in 0.1 s windows. A black stretch where a picture was
planned, or a narration that does not stand out from the rest of the mix by
6 dB where it was placed, is a warning; anything else wrong is a failure, and
the failed checks are kept with the job.

Only then is the file moved to the export folder under a new name (never
replacing a file) and recorded in `renders`, with its checks and the plan's
hash. That hash identifies the content, not file locations, so the Export tab
can show whether a render matches the current edit.

**Remotion and the network.** `renderMedia` reports each render to
remotion.pro when it is given a licence key, including `"free-license"`.
Framebop never passes one, which is the only setting that makes no request.
Remotion also downloads Chrome by itself when it has none; the worker refuses
to start without an existing browser, so that cannot happen.

### 2D animation

Scenes planned as "Layered 2D animation" are drawn by Framebop's own engine
(`packages/renderer/src/animation/`) inside the same Remotion composition, as
SVG generated by React. The renderer itself does not change: the plan gets an
`animation` visual, and the render, the checks and the export are the same as
for any other scene. No canvas or WebGL library is added: SVG is drawn by the
same headless Chrome and is enough for flat vector art.

- **The scene format** (`AnimationSpecSchema` in
  `packages/core/src/animation.ts`) lists reusable props (assets), layers
  with a parallax factor and optional blur, characters with a timeline of
  motion clips, and a camera made of keyframe tracks, an optional follow of
  one character, and shakes. It is stored as JSON with the scene's plan.
- **Everything is a function of the frame number.** Keyframes, easing, prop
  motion (sway, drift, flutter, flicker, fly, bob, pop), blinking and noise
  are computed from the time alone, never from timers or state kept between
  frames. The camera's follow averages where the character has been, which
  gives a smooth lag without state. A frame renders the same in any order;
  the tests compare frames drawn in different orders, and two Remotion
  stills of one frame are byte-identical.
- **Characters** are a bone hierarchy (hips, torso, neck, head; shoulder,
  upper arm, forearm, hand; thigh, shin, foot) with fixed pivots, drawn from
  vector shapes in units of the character's height. Walking is driven by
  distance: each foot is planted where it lands and stays there until it
  lifts, and two-bone IK bends the legs to reach it, so planted feet do not
  slide at any speed. Speed rises and falls at the start and end, steps get
  shorter as it slows, and the walk is timed to end with both feet down.
  The hips sit as high as both legs reach, which gives the walk its rise
  and fall. Reach uses arm IK towards a point; surprise, talk and gesture
  are blended in and out by weight.
- **Mouths follow the narration.** When the plan is made, the scene's
  narration is decoded with FFmpeg and its loudness measured per frame
  against the voice's own loud parts. A character marked as speaking the
  narration opens its mouth with it. It is loudness, not phonemes.
- **Templates.** The Roman street (`templates.ts`) is an original demo
  scene, made only from the procedural props and the rig. The Blueprint can
  apply it to a scene; other scenes can be given any valid configuration
  through `blueprint.updatePlan`.

- **Walk style** (`WalkStyleSchema`) is set per character: pelvis bounce,
  step height, arm swing and elbow bend, lean, shoulder and pelvis twist,
  heel strike and toe-off angles, and how many frames the head lags. A step
  goes contact, down, passing, up: the landing foot comes down heel first
  and rolls flat around the heel, the standing foot rolls onto its toes
  around the toe, and whichever point touches the ground stays put. The
  pelvis dips after contact and rises over the standing leg; the forearm and
  hand follow the upper arm a beat later; the head nods after the body.
- **Sprite characters.** A character with a `sprites` rig is drawn from
  pictures of its parts (head, eyes, mouths, torso, skirt, upper and lower
  arm, hand, thigh, shin, foot) instead of vector shapes. Each picture has a
  pivot at its joint; limbs also have a tip at the next joint and are
  stretched so the tip meets it. `sprites.ts` turns a pose into the list of
  placed pictures, far side first, and both renderers draw that list.
- **Two renderers.** `renderer: "svg"` draws everything with React SVG.
  `renderer: "pixi"` draws with PixiJS 8 (WebGL) into one canvas: the ticker
  is off and each frame is drawn once from the frame number, after the
  pictures have loaded (the render waits with `delayRender`). PixiJS draws
  only pictures (image props and sprite characters); the plan refuses a
  PixiJS animation with vector art. The render worker turns on ANGLE for
  WebGL only when a PixiJS scene is in the plan. Two stills of one frame,
  rendered in a different order, are byte-identical.
- **Pictures** an animation uses are library assets, listed in its
  `images`. The plan resolves them to files, the worker serves them like
  other media, and the library's clean-up counts them as in use.
- **Preview.** The Blueprint plays a layered-2d scene with the same scene
  component the composition uses (`@framebop/renderer/scene`), with play,
  pause and a frame slider. `blueprint.animationPreview` gives it the spec,
  the pictures and the measured mouth.
- **Test art.** `packages/renderer/test-art/` holds temporary pictures drawn
  in SVG for this project (a Roman man cut into parts, painted street
  layers), baked to PNG by `bake.mjs`. They exist to test sprites and are
  not production art.

Limits: characters are seen only from the side and do not turn (a walk in
the other direction flips them); mouths follow loudness, not phonemes;
sprite limbs are rigid pictures, so knees and elbows show where the parts
overlap; the PixiJS renderer has no vector props; there is no animation
editor.

## Speech

`packages/ai-adapters/src/adapters/kokoro.ts` runs Kokoro-82M through the
`kokoro` Python package, in an interpreter chosen in Settings. Framebop does
not ship Python yet, so this is how an existing, working installation is
reused. It loads the PyTorch release of the model from the files it is given
(an installation from the model manager, or the read-only Hugging Face
cache), never from the network: the Hugging Face client is put in offline
mode as well. Python runs with `-I -B` and `PYTHONDONTWRITEBYTECODE`, so it
writes nothing into the interpreter's installation.

Each run is a new process that reads one request, speaks the narration
sentence by sentence (the progress shown), and writes a 16-bit mono WAV. The
adapter then reads the file's header itself: an empty or invalid file is a
failure, whatever the script said. Voices are the voice files next to the
model; English ones are offered, the others are listed as not supported.

Narration is an `audio_generation` job like images and clips: it lands in the
scene's narration slot if that is empty, and is otherwise kept as a take the
user can switch to. Imported narration works without any of this.

## Video DNA Lab

Research on reference videos; see [video-dna.md](video-dna.md) for what it
collects and why. The pieces:

- `@framebop/research`: the YouTube Data API client (`youtube.ts`), which
  normalises responses and records why a value is missing; transcript
  parsing (`transcript.ts`); the rule-based findings and coverage report
  (`analysis.ts`); and the contract for later AI analysis with its grounding
  check (`inference.ts`). All of it is pure or takes its network client as a
  parameter, and is tested against a stand-in API (`testing.ts`).
- `ResearchService` (`packages/orchestrator/src/services/research.ts`) owns
  the workflow: it parses links (only the id is used), calls the API on
  request, stores snapshots, samples and transcripts, and recalculates the
  rule-based findings whenever the data changes. A user's note may cite only
  data from its own project; each citation is resolved to the stored item,
  whose quote, source and date are copied into the evidence.
- `YouTubeKeyStore` keeps the API key in the system's secret store
  (`packages/ai-adapters/src/host/secrets.ts`) or, where there is none, in
  memory. The key never reaches the database, the settings, the log or the
  interface.

## Interface languages

The interface is translated into English, Spanish, Brazilian Portuguese,
Turkish and German with i18next (`apps/desktop/src/i18n/`). English is the source and
the fallback; the other languages load only when chosen.

- **Keys** are `namespace:key`, one namespace per area of the app, and are
  typed from the English resources: a key that does not exist is a type
  error, and every locale must have every English key (also a type error).
  `i18n.test.ts` checks that each translation has the same `{{placeholders}}`
  as English and every plural form its language uses (Spanish and
  Portuguese have a "many" form for millions).
- **`t()` works anywhere**, in components, stores and helpers. The app root
  subscribes to language changes and re-renders in place, so switching
  language never remounts a view or resets an editor, playback or a job.
- **Choosing the language.** Settings holds `uiLanguage`: "system" or an
  explicit language. For "system", the engine reports the operating
  system's preferred languages in order (`system.info`: AppleLanguages on
  macOS, the user's language list on Windows, POSIX locale variables
  elsewhere), because a webview's `navigator.languages` does not reliably
  follow them. The first supported language wins, by language then base
  language (`pt-PT` uses Brazilian Portuguese until it is translated), else
  English. The last language shown is cached in local storage so the first
  frame of the next start is already in it.
- **Formatting** of numbers, sizes, dates and content-language names goes
  through `Intl` in the interface language. Stored values never change.
- **Content languages stay separate.** A project's narration language,
  scripts, subtitles, voices and AI output are not tied to the interface.
- **What stays English:** texts the engine writes (engine and adapter
  descriptions, availability reasons, preflight and render notices, model
  compatibility reasons, error details). An error shows a translated summary
  of what failed, followed by the engine's detail. Job labels follow fixed
  patterns and are translated by pattern in the interface.

## Cross-platform design

`HostPlatform` (`packages/ai-adapters/src/host/platform.ts`) is the only place
that may contain operating-system paths, commands or conventions: executable
suffixes, where package managers install tools, how to find an installed
application. Everything else asks a `HostPlatform`, and tests substitute a fake
one.

Other measures:

- External programs are run with an argument array and no shell.
- Paths are built with `node:path`, never by concatenating separators.
- The data directory comes from Tauri's per-platform API.
- The macOS-only window chrome (traffic lights over the top bar) is applied
  only on macOS.
- Scene reordering uses pointer events, because Tauri reserves native drag and
  drop for files from the operating system, which disables HTML5 drag and drop
  in the webview on some platforms.

What has not been done: building or running on Windows or Linux. Expect small
issues there.

## Shipping Node.js with the app

End users must not need Node.js. The app carries its own.

Tauri bundles extra executables as "sidecars" (`bundle.externalBin`), which
must be named `<name>-<target triple>`. `apps/desktop/scripts/prepare-sidecar.mjs`
copies a Node.js binary to `src-tauri/binaries/framebop-node-<triple>`, and the
engine bundle is included as a resource. At run time the shell starts:

```
framebop-node --disable-warning=ExperimentalWarning --enable-source-maps \
  <resources>/engine/worker.mjs --transport stdio --data-dir <data dir>
```

Development and packaged builds differ in two ways, both deliberate:

|                 | `pnpm dev`                                 | Packaged app                         |
| --------------- | ------------------------------------------ | ------------------------------------ |
| Engine bundle   | Read from the workspace, so rebuilds apply | Read from the app's resources        |
| Node.js runtime | A copy of the developer's own Node.js      | Must be an official build per target |

The sidecar is used in both, so the launch path is the same code.

A desktop app launched from the Finder, Start menu or a launcher gets a much
shorter `PATH` than a terminal. That is why the engine also looks for FFmpeg in
each platform's usual install directories.

**Not done yet, required before a public release:**

- Download the official Node.js build for each target and verify its checksum,
  instead of copying whatever Node.js runs the build.
- Code-sign and notarise the macOS app, including the Node.js binary with the
  hardened-runtime entitlements a JIT needs.
- Decide whether to shrink the roughly 100 MB runtime, for example with a
  Node.js single executable application or a build without `Intl` data.

## Security model

- **No network surface.** The engine talks over stdin and stdout. Nothing
  listens on a port.
- **Outbound requests only on request.** The engine contacts
  `huggingface.co` to search and to download a model the user approved, with
  no credentials. Video DNA Lab contacts only the YouTube Data API's fixed
  address, with the user's key in a header, when the user asks; a pasted link
  is parsed for its video id and never requested. Rendering makes no
  requests; see above.
- **Secrets stay in the system's secret store.** The YouTube API key is kept
  in the macOS Keychain or the Linux Secret Service, written through standard
  input so it never appears in a process list, and is never logged or
  returned to the interface.
- **Separate processes for heavy work.** The render worker, its headless
  browser and Kokoro run as their own processes, started with fixed
  arguments and no shell. The render worker reads media only through its
  loopback server, which serves the plan's files and nothing else. A job may
  name a model file by path only if the model picker offered it.
- **Exports are the user's files.** They are written under new names in the
  chosen folder and never replaced or deleted. The webview may read them only
  from the library's own `exports/` folder; the system player may open any
  `.mp4` file the user picks there.
- **Minimal webview permissions.** `src-tauri/capabilities/default.json`
  grants the window: core defaults, dragging and closing the window, open and
  save dialogs, and revealing a file in the file manager. It grants no
  filesystem and no shell permissions. The shell plugin is used only from Rust,
  to start the engine with fixed arguments.
- **Scoped media access.** The webview reads media through Tauri's asset
  protocol, whose scope is set at run time to the library's `media/` folder
  and nothing else.
- **Content Security Policy.** Scripts load only from the app itself. There
  is no remote content.
- **Input validation.** Every engine call is validated against a strict
  schema. Identifiers must be UUIDs.
- **Path containment.** Media paths are resolved through one function that
  rejects anything outside the media root. File names inside the library are
  generated, never taken from user input.
- **No shell.** External tools are run with `execFile` and an argument array.
- **Destructive actions are explicit.** Deleting a project, episode or scene
  with content, removing media, or removing a model asks first. Only library
  copies and files of Framebop's own model installations are ever deleted.

### Development bridge

`pnpm dev:web` runs the interface in a normal browser. Browsers have no Tauri
IPC, so in this mode only, the engine starts a small HTTP server
(`packages/orchestrator/src/transports/dev-http.ts`). It is not part of the
packaged app. It binds to `127.0.0.1`, requires a random per-run bearer token
that the Vite dev server adds when proxying (so the token never reaches browser
code), checks the `Host` header to defeat DNS rebinding, and sends no CORS
headers.

## Testing

`pnpm test` runs Vitest in each package:

- `core`: script splitting, formatting, schema behaviour.
- `database`: migrations, repositories, persistence across reopen.
- `ai-adapters`: host platform behaviour, engine status, the registry, the
  PNG encoder, the test adapter's lifecycle, and both Draw Things adapters
  against stand-ins that follow the published interfaces: a local HTTP server
  that rejects unknown keys, and a script in place of the command-line tool.
  The hardware parsers run against recorded `system_profiler`, `nvidia-smi`,
  Windows and `lspci` output.
- `model-manager`: catalog validation, hashing, the downloader against a local
  stand-in for the Hugging Face server (progress, dropped connections and
  resuming, servers that ignore ranges, corrupted data, cancelling), path and
  ownership checks for removal, discovery and compatibility rules. No test
  downloads a real model.
- `orchestrator`: the job queue on its own (ordering, lanes, cancelling,
  retrying, holding, and recovery after both a crash and a normal quit); the
  production workflow end to end through `dispatch` with the test adapter;
  and the whole engine through its public `dispatch`, including
  import, deduplication, cleanup, restart recovery, both transports and the
  development bridge's access control. The model service is tested the same
  way against the local hub stand-in: approval and disk-space refusals that
  make no request, stale catalog entries, cancelling, resuming after a dropped
  connection, interruption by a quit, tampering found by re-verification,
  removal that leaves foreign files alone, read-only external folders, and
  installed, compatible and runnable kept apart. One suite bundles the engine and runs
  it as a real child process, to check that it answers over stdio and exits
  when its parent disappears. One test runs the real FFmpeg and is skipped
  where FFmpeg is not installed.
- `renderer`: the plan's timing rules (frames, narration never cut or
  overlapping, fades, held frames, music, approximate captions, errors for
  missing media), and that a plan's identity ignores where files are.
- Rendering in `orchestrator`: the output checks against real files made
  with FFmpeg (good, wrong size and frame rate, no audio, silent or missing
  narration under music, black picture, truncated file), and an end-to-end
  render of three scenes with stills, a clip, narration, music, fades,
  overlays and captions through the real worker and Remotion, followed by a
  restart, a cancelled render and refused damaged or missing media. This
  suite needs FFmpeg and a Chrome build in `FRAMEBOP_RENDER_BROWSER`, and is
  skipped without them. Narration and music jobs are tested with a stand-in
  speech engine, and the Kokoro adapter with a stand-in interpreter that
  speaks its protocol.
- `desktop`: pure helpers of the interface only.

The interface's components and the Rust shell have no automated tests yet.
