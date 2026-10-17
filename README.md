<div align="center">

<img src="apps/desktop/src-tauri/icons/128x128@2x.png" alt="Framebop Studio" width="128" height="128">

# Framebop Studio

**Make animated videos with AI that runs on your own computer.**<br>
From an idea to a finished MP4: script, scenes, pictures, voice and render, in one app.
No account, no subscription, no cloud.

[![Version](https://img.shields.io/badge/version-0.1.0%20alpha-f97316)](docs/roadmap.md)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Platform: macOS today, Windows and Linux planned](https://img.shields.io/badge/platform-macOS%20today%20·%20Windows%20%26%20Linux%20planned-lightgrey)](#platform-support)
[![Local-first](https://img.shields.io/badge/local--first-yes-22c55e)](#privacy-and-security)
[![Telemetry](https://img.shields.io/badge/telemetry-none-22c55e)](#privacy-and-security)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-8b5cf6)](CONTRIBUTING.md)
<br>
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Models: Hugging Face](https://img.shields.io/badge/models-Hugging%20Face-FFD21E?logo=huggingface&logoColor=000)](docs/models.md)

[Features](#features) · [Requirements](#system-requirements) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Documentation](#documentation) · [Contributing](#contributing)

</div>

https://github.com/user-attachments/assets/799f0207-cca8-4f8d-bd06-9bad2fed33ee

---

## Why Framebop Studio

Making a video with AI usually means a dozen tools, accounts and uploads.
Framebop Studio puts the whole path in one place, and keeps it on your
machine:

```
Idea → Script → Scenes → Pictures → Animation → Narration → Timeline → Final MP4
```

- **Simple enough for a child.** Three steps (Script, Scenes, Video), and one
  button to get each AI part ready, with the download size shown first.
- **Private by design.** Your projects, prompts and media never leave your
  computer. No telemetry, no account, works offline once set up.
- **Nothing hidden.** Every AI program and model is pinned to an exact
  version and checked against its published SHA-256 before it is used, and
  downloaded only after you agree. The app says plainly what works and what
  does not.
- **Open.** Apache 2.0, with engines behind small adapters, so new models and
  backends can be added without touching the rest.

> [!NOTE]
> Framebop Studio is in **early development (alpha)**, developed and tested
> on macOS with Apple silicon only; Windows and Linux are not tested yet (see
> [Platform support](#platform-support)). The features below marked
> _experimental_ or _prototype_ are not finished. See [Status](#status) for
> the honest state of each step.

## Features

### ✍️ Write

Write or paste a script and split it into scenes, or press **Write with AI**:
Framebop installs its own [llama.cpp](https://github.com/ggml-org/llama.cpp)
and Qwen3 4B (2.5 GB) with one consent and drafts a script in your project's
language. The draft goes into your script only when you choose.

### 🖼️ Pictures

**Make with AI** in a scene uses Framebop's own
[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp):
about 24 seconds for a 512 × 512 picture on an Apple M4 Pro, with Stable
Diffusion 1.5. Larger, newer models can be added from the catalog or from
Hugging Face. Or upload your own picture.

### 🗣️ Voice

**Read with AI** narrates each scene with Framebop's own
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) voice engine, with a
voice for every interface language: Kokoro for English, Piper voices for
Turkish, German, Spanish and Brazilian Portuguese. Narration lengths come
from the audio, and a scene is never cut short of its narration.

### 🎞️ Moving clips _(experimental)_

**Make it move** turns a scene's picture into a short clip with Wan 2.2 TI2V
5B. Sampling works on Apple silicon, but decoding the frames is still far too
slow to be useful. Uploading your own clips works today.

### 🕺 2D animation _(prototype)_

A built-in engine for vector or sprite characters with camera moves, drawn in
SVG or PixiJS. Demo scenes with test art only, for now.

### 🎬 Render and check

The final video is rendered with [Remotion](https://www.remotion.dev) at
1080p or 720p (H.264/AAC): stills with slow camera moves, clips, cuts and
fades, text, narration, background music and captions. FFmpeg then checks
every file before it is listed: duration, frame rate, codecs, that every
frame decodes and that each narration can be heard where it was placed.
Renders of the same edit are identical, byte for byte.

### 🧩 Models, your way

- A small, reviewed **catalog**: every model pinned to a Hugging Face commit,
  every file to its size and SHA-256, with its licence shown before download.
- **Any Hugging Face repository of separate weights** (ComfyUI-style or
  GGUF), without waiting for a catalog entry: Framebop suggests which file is
  the diffusion model, the VAE and the text encoders, you confirm, and only
  the files you chose are downloaded and verified.
- Models made of **shared parts**: a text encoder used by several models is
  downloaded once and is not removed while something uses it.
- Folders of other applications can be added as **read-only sources**.
- Downloads survive a quit or a crash and resume where they stopped.

### 🔬 Video DNA Lab

Study reference videos: with your own YouTube Data API key, fetch a video's
public details and comments, import a transcript you may use, and get
findings that each cite the data they rest on, from simple rules and from a
local language model. The **Story Architect** turns a concept into an outline
and scenes you edit and approve.

### ⚙️ Production queue

Every generation is a job: real progress, cancel, retry, hold and resume,
with a history that survives restarts. A job interrupted by a quit is never
restarted on its own.

## Status

| Step                  | State        | What you can do today                                                                                                 |
| --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Projects and episodes | Works        | Create, edit, delete. Stored in a local SQLite database.                                                              |
| Script                | Works\*      | Write or paste, split into scenes, or draft one with llama.cpp and Qwen3 4B.                                          |
| Scenes                | Works        | Add, edit, duplicate, delete, drag to reorder. Edits save automatically.                                              |
| Pictures              | Works\*      | One-click setup of stable-diffusion.cpp and a model; about 24 s per 512 px picture on an M4 Pro.                      |
| Moving clips          | Experimental | Wan 2.2 TI2V 5B. Sampling works; decoding the frames is far too slow on Apple silicon so far.                         |
| Narration             | Works\*      | sherpa-onnx with a voice per interface language, or Kokoro through a Python you choose.                               |
| Imports               | Works        | PNG, JPEG, WebP, MP4, MOV, M4V, WebM, WAV, MP3, M4A, FLAC. Files are copied into a library.                           |
| Preview               | Works        | Play clips and stills scene by scene, or straight through the episode.                                                |
| Production jobs       | Works        | Queue, progress, cancel, retry, hold and resume. History and safe recovery across restarts.                           |
| 2D animation          | Prototype\*  | Vector or sprite characters, camera, SVG or PixiJS. Demo scenes with test art only.                                   |
| Final MP4 render      | Works\*      | Remotion renders 1080p or 720p H.264/AAC; FFmpeg then checks the file.                                                |
| Models                | Works        | Pinned catalog, or any Hugging Face repository of separate weights by choosing its parts. Hash-checked and removable. |

\* In the development build (`pnpm dev`, `pnpm dev:web`) on macOS with Apple
silicon, the only platform Framebop's own runtimes are pinned for so far.
The installed app does not contain the renderer yet.

Known gaps: clips made with AI are not usable yet; the preview plays each
clip at its own length; WebM may not play in the macOS webview (H.264 MP4
plays everywhere); Windows and Linux builds and signed installers are planned.
What comes next is in the [roadmap](docs/roadmap.md).

## Quick start

### Requirements

- [Node.js](https://nodejs.org) 22.13 or newer and [pnpm](https://pnpm.io) 11
- [Rust](https://rustup.rs) (stable) and the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/); on macOS,
  the Xcode Command Line Tools (`xcode-select --install`)
- Optional: [FFmpeg](https://ffmpeg.org) (`ffmpeg` and `ffprobe`), for
  measuring imports, thumbnails, clips and checking renders
- For rendering: a Chrome build for Remotion, chosen in **Settings →
  Rendering**. Framebop never downloads one.

No AI model is needed to build or run the app. Models and engines are
downloaded from inside the app, only when you ask.

### Run it

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds the engine, starts the interface and opens the desktop app.
The first run compiles the Rust shell, which takes a few minutes.

Then: create a project, write or paste a script, choose **Create scenes**,
and in each scene press **Get ready** once for pictures and for voice. After
that, **Make with AI** and **Read with AI** work offline.

### Commands

| Command             | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `pnpm dev`          | Runs the desktop app in development.                         |
| `pnpm dev:web`      | Runs the interface in a browser, with its own library.       |
| `pnpm typecheck`    | Type-checks every package.                                   |
| `pnpm format:check` | Checks formatting (`pnpm format` fixes it).                  |
| `pnpm test`         | Runs each package's tests.                                   |
| `pnpm build`        | Builds the renderer, the engine and the interface.           |
| `pnpm build:app`    | Builds a distributable application for the current platform. |

`FRAMEBOP_DATA_DIR=/some/folder` points any run at its own library, so
experiments never touch your real one.

## How it works

```
┌──────────────────────────────┐      private pipe      ┌──────────────────────────────┐
│ Desktop app (Tauri 2)        │ ◄────────────────────► │ Engine (Node.js)             │
│ React interface; reads media │                        │ library · jobs · models      │
│ from the library only        │                        │ runtimes · render · checks   │
└──────────────────────────────┘                        └──────────────┬───────────────┘
                                                                       │ adapters
                    ┌──────────────────────┬───────────────────────────┼──────────────────────┐
                    ▼                      ▼                           ▼                      ▼
           stable-diffusion.cpp       sherpa-onnx                  llama.cpp          Remotion + FFmpeg
           pictures and clips         narration                    script drafts      render and checks
```

- The **interface** has no general filesystem or shell access and reads
  media only from the library; it talks to the engine through a private
  pipe, not a network port.
- The **engine** owns the library (one folder with the database, media,
  models and exports), runs every generation as a job, and knows backends
  only through adapter interfaces.
- **Runtimes** (stable-diffusion.cpp, sherpa-onnx, llama.cpp) are official
  upstream builds, each pinned to one release, URL and SHA-256, installed in
  the library's `runtimes` folder after your consent.
- **Models** describe themselves in the catalog: which file is the diffusion
  model, the VAE or a text encoder. The engine passes each part to the
  runtime by its role, so a new model of a kind the runtime supports needs no
  code.

More in [docs/architecture.md](docs/architecture.md).

## Platform support

> [!IMPORTANT]
> All development and testing so far has been done on **macOS with Apple
> silicon** (an Apple M4 Pro with 24 GB of memory). Framebop Studio has not
> yet been built or run on Windows or Linux; those platforms will be tested
> in a later phase, and until then support there is unverified.

| Platform             | State                                                             |
| -------------------- | ----------------------------------------------------------------- |
| macOS, Apple silicon | Developed and tested here. Framebop's own runtimes are pinned.    |
| macOS, Intel         | The app is expected to work; Framebop's own runtimes are not yet. |
| Windows 10 and 11    | Designed for; not yet built or tested.                            |
| Linux                | Designed for; not yet built or tested.                            |

Everything that depends on the operating system sits behind one interface
(`packages/ai-adapters/src/host/platform.ts`).

## System requirements

|                 | Minimum                                                         | Recommended                     |
| --------------- | --------------------------------------------------------------- | ------------------------------- |
| Computer        | Today, a Mac with Apple silicon (Windows and Linux are planned) | A Mac with Apple silicon        |
| macOS           | 13.3 or newer; pictures need 26                                 | 26 Tahoe or newer               |
| Memory          | 8 GB (expected, not tested yet)                                 | 16 GB or more                   |
| Free disk space | 5 GB for the engines and their models                           | 15 GB, to also try moving clips |

The pinned stable-diffusion.cpp build needs macOS 26, so on macOS 13.3 to 15
pictures can be imported but not made with AI; script drafts (llama.cpp,
macOS 13.3) and voice (sherpa-onnx, macOS 11) run there.

Only an Apple M4 Pro with 24 GB has been tested so far. Building from
source needs about 5 GB more for the Node.js packages and the Rust build
(see [Requirements](#requirements)).

### What each feature needs

Each AI engine runs on its own and stops when its job is done, so what
counts is the heaviest single step, not the sum. Measured on the M4 Pro with
the default models:

| Feature                      | Engine and model                               | Peak memory | Time on an M4 Pro                       |
| ---------------------------- | ---------------------------------------------- | ----------- | --------------------------------------- |
| Script draft                 | llama.cpp, Qwen3 4B (2.3 GB)                   | 3.7 GB      | 6 s for a one-minute, three-scene draft |
| Picture                      | stable-diffusion.cpp, SD 1.5 Q8 (1.6 GB)       | 4.2 GB      | 25 s per 512 × 512 picture              |
| Voice                        | sherpa-onnx, Kokoro (English)                  | 0.6 GB      | 7 to 9 s per scene                      |
| Final video                  | Remotion and FFmpeg                            | 1.6 GB      | 21 s for a 61-second 1080p video        |
| Moving clip _(experimental)_ | stable-diffusion.cpp, Wan 2.2 TI2V 5B (7.9 GB) | 9.8 GB      | Not usable yet: decoding is too slow    |

Peak memory is how much the computer's used memory (app memory, wired and
compressed) grew while the step ran, including the model the engine loads.
The window of the app itself is not included. Smaller chips will be slower.

### By amount of memory

| Memory | Tested  | What to expect                                                                                                                                        |
| ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 GB   | Not yet | Script drafts, pictures, voice and the final video should each fit, one at a time. Close other apps while making pictures. Moving clips will not fit. |
| 16 GB  | Not yet | Everything except moving clips, with room for other apps.                                                                                             |
| 24 GB  | Yes     | Everything in the table above; the measurements come from this machine.                                                                               |

The 8 GB and 16 GB rows are worked out from the measurements, not tested on
such a Mac. If you have one, please
[open an issue](https://github.com/eaabak/framebop-studio/issues) with your
model, memory and what worked; this table will be updated from real reports.

## Where your data is stored

Everything lives in one library folder: the database, copies of imported
media, thumbnails, models, runtimes, exported videos and the engine log.

| Platform | Default location                                    |
| -------- | --------------------------------------------------- |
| macOS    | `~/Library/Application Support/com.framebop.studio` |
| Windows  | `%APPDATA%\com.framebop.studio`                     |
| Linux    | `~/.local/share/com.framebop.studio`                |

Imported files are copied, never moved or linked. Finished videos go to
`exports/` and are never overwritten or deleted by the app. To uninstall,
delete the application and that folder.

## Privacy and security

- No telemetry, analytics or crash reporting.
- Network requests happen only when you ask: to Hugging Face and GitHub to
  download models and runtimes you approve (no account or token), and in
  Video DNA Lab to the YouTube Data API with your own key, kept in the
  system's secure storage.
- Every download is checked against its pinned SHA-256 before it is used.
- Rendering makes no network requests: Remotion is given no licence key and
  an existing browser, so it neither reports usage nor downloads anything.
- Framebop deletes only files inside folders it created and recorded; other
  applications' models are read-only.

Found a problem? See [SECURITY.md](SECURITY.md). Details are in
[docs/architecture.md](docs/architecture.md#security-model).

## Repository layout

```
apps/desktop/            Desktop app: React interface (Tailwind, Zustand) and Tauri shell (Rust)
packages/core/           Shared schemas and the interface ↔ engine contract
packages/orchestrator/   The engine: library, jobs, models, runtimes, rendering
packages/ai-adapters/    One adapter per backend, host and hardware detection
packages/model-manager/  Catalog, verified downloads, storage, Hugging Face import
packages/renderer/       Render plan, Remotion composition and render worker
packages/database/       SQLite connection, migrations, repositories
packages/research/       Video DNA Lab: YouTube client, transcripts, analysis
docs/                    Architecture, roadmap, models, licensing, research
```

## Documentation

| Document                             | About                                               |
| ------------------------------------ | --------------------------------------------------- |
| [Architecture](docs/architecture.md) | Processes, the engine, adapters, the security model |
| [Roadmap](docs/roadmap.md)           | What is done, measured and next, phase by phase     |
| [Models](docs/models.md)             | The model manager, downloads, storage, sources      |
| [Registry](docs/registry.md)         | The catalog format and how entries are reviewed     |
| [Video DNA Lab](docs/video-dna.md)   | Research tools and their limits                     |
| [Draw Things](docs/draw-things.md)   | What the optional Draw Things engines can do        |
| [Licensing](docs/licensing.md)       | Licences of everything Framebop works with          |

## Contributing

Contributions of every size are welcome: bug reports from real use, models
for the catalog, translations, code. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Please report security problems
privately, as described in [SECURITY.md](SECURITY.md).

## License

Framebop Studio is licensed under the [Apache License 2.0](LICENSE).

### Third-party software and models

Framebop Studio works with software and models that keep their own licences.
They are not part of this repository; the app downloads or uses them only
when you choose to.

- **Remotion is not open source.** The final render uses
  [Remotion](https://www.remotion.dev) under the
  [Remotion License](https://www.remotion.dev/docs/license): free for
  individuals, non-profits, companies of up to three people and for
  evaluation; larger companies need a Remotion company licence. Framebop
  sends Remotion no licence key and no usage data.
- **Runtimes Framebop installs** with your consent: stable-diffusion.cpp
  (MIT), llama.cpp (MIT) and sherpa-onnx (Apache 2.0), each pinned to an
  exact build and SHA-256.
- **FFmpeg**, which checks every file, is used from your system. Remotion's
  renderer contains FFmpeg libraries of its own, under their licences.
- **Models** each have their own licence, shown before every download. Some
  restrict commercial use; read them before publishing what you make.

Details and open questions are in [docs/licensing.md](docs/licensing.md).

<div align="center">
<br>
<sub>Made for people who want to tell stories, not manage tools.</sub>
</div>
