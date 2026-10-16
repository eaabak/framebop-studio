# Roadmap

Framebop Studio is built in phases. Each phase should leave the application in
a usable, honest state: features that do not work yet are labelled as planned
in the interface, never shown as if they worked.

## Phase 1: desktop foundation (done)

- pnpm monorepo, Tauri 2 shell, React interface
- Engine as a separate process with a typed, validated contract
- SQLite library with migrations
- Projects, episodes and scenes: create, edit, reorder, delete
- Script editor and deterministic script-to-scenes splitting
- Media import with managed copies, deduplication and cleanup
- Preview with playback, storyboard, timeline, scene inspector
- Job records with measured progress, cancel and retry for imports
- Settings, session restore, engine and hardware detection
- Automated tests for the engine and its packages

Not covered: tests for the interface and the Rust shell, and any build or run
on Windows or Linux.

## Phase 2: production engine (done)

- Persistent job queue in SQLite: pending, running, completed, failed,
  cancelled, interrupted
- One production job at a time, with imports in a lane of their own
- Cancel, retry as a numbered new attempt, hold and resume the queue
- Safe recovery: interrupted jobs are never restarted automatically, and
  waiting production jobs are held until the user resumes
- Adapter contracts, registry, and engine-enforced consent for expensive runs
- A deterministic test adapter that needs no model
- Draw Things adapters for its HTTP API (images) and its command-line tool
  (images and video), both experimental
- Generate from a scene, live job status, results kept as takes, a Production
  view with queue, history and each engine's real capabilities
- One engine per library, enforced with a lock; snapshot before schema upgrades

Not covered, and carried forward:

- **Neither Draw Things adapter has been run against the real software.** The
  API server was off and the command-line tool was not installed on the
  development machine. See [draw-things.md](draw-things.md) for how to verify.
- No audio generation or rendering adapter exists, so those job kinds cannot
  be created yet.
- ComfyUI, and therefore any engine for Windows and Linux.
- Tests for the interface and the Rust shell. Windows and Linux builds.

## Phase 3: model manager (done)

- Hardware inventory on every platform: operating system, processor, memory,
  GPUs with their memory where it can be read reliably, free space, and the
  compute back ends present (CPU, Metal, CUDA, ROCm), with every value that
  could not be determined listed with its reason
- A typed, validated catalog of models pinned to exact Hugging Face commits,
  with each file's size and hash, licence, access restrictions and stated
  hardware requirements
- Installed, compatible and runnable reported separately; adapters explain
  whether they can run a model, before and after it is installed
- Downloads only on approval, enforced by the engine: free-space check,
  metadata check against the pinned commit, streamed and hashed files, real
  byte progress, cancel, resume with range requests after a dropped connection
  or a crash, never restarted automatically
- Verification of every file before a model counts as installed, and on
  request afterwards
- Removal limited to the files Framebop downloaded, with an ownership marker
  and path checks; a configurable storage location
- Read-only discovery in folders the user adds, including the Hugging Face
  cache
- A Models tab with Discover, Installed, Downloads and Hardware sections
- A searchable model picker in a scene's Generate section: what is on this
  computer, what can be downloaded, and what the engine cannot use, with the
  reason

One real model (Kokoro 82M, ONNX 8-bit, 92.9 MB) was downloaded from Hugging
Face through the application, interrupted by killing the engine, resumed with
a range request and verified.

Not covered, and carried forward:

- **No engine ran a downloaded model in this phase.** (Phase 4 added one for
  the PyTorch release of Kokoro.) LTX-2 still needs its own runtime.
- **Neither Draw Things adapter has been run against the real software**, so
  which engine to build on is still undecided.
- ComfyUI, and with it an engine for Windows and Linux.
- A managed runtime so models can run without a user-configured Python.
- Reading an engine's own model list. The scene's model picker lists files in
  folders the user added, so Draw Things' models folder can be added, but
  Draw Things itself does not publish its list.
- Gated models, which need an access token kept in the operating system's
  secure storage.
- The Windows and Linux hardware detection has only been tested against
  recorded tool output, not on those systems.
- Tests for the interface and the Rust shell. Windows and Linux builds.

## Phase 4: audio and rendering (done in development; not yet in the installed app)

- A deterministic render plan: scenes, fades, held frames, narration placed
  to the frame and never cut, music, approximate captions, all in whole
  frames, with errors and warnings shown before rendering
- A Remotion composition for stills with simple camera moves, clips, cuts and
  fades, text overlays, captions, narration and looping music, 16:9 at 1080p
  or 720p, 24, 25 or 30 fps
- Rendering as a queued job in a separate worker process, with measured frame
  progress, cancelling, recovery after a restart, and output in a chosen
  folder that is never overwritten
- Every export checked with FFprobe and one decoding pass before it is
  listed: duration, size, frame rate, codecs, readability, black picture,
  narration audible where it was placed; results kept with the render
- Narration with Kokoro-82M through the user's own Python with `kokoro`,
  offline, from model files the model manager installed or found; voices read
  from the model's folder; measured lengths
- Background music per episode; transitions and text overlays per scene;
  export settings, render progress, previews and the list of renders in the
  interface

Verified on the development machine: a three-scene, 15.9-second 1080p30 MP4
with Kokoro narration, music, fades, overlays and captions, rendered through
the interface in under ten seconds, checked, previewed, still listed after a
restart, rendered three times to byte-identical files, and cancelled
mid-render without leaving files behind.

Not covered, and carried forward:

- **The installed app cannot render.** The render worker, the bundled
  composition and Remotion's renderer with its native compositor are not
  packaged yet, and the user must provide a Chrome build. Shipping them
  (with their licences and the browser) is the main release blocker.
- **Narration needs a user-provided Python with `kokoro`.** A managed runtime,
  or running the ONNX release of Kokoro without Python, is still to come.
- English voices only. Voices are those next to the model; the catalog
  entry includes one.
- Captions are timed by sentence length. Word-level timing would need
  alignment against the audio (Kokoro predicts token durations, which could be
  used).
- A clip's own sound is muted. Music loops without a cross-fade at the loop
  point.
- Renders are not reused scene by scene: a change re-renders the whole video
  (a 16-second 1080p video takes under ten seconds here).
- Text uses the system's fonts, so it can look slightly different on other
  platforms. Windows and Linux are untested.
- Opening an export in the system player, revealing it, and the native folder
  and file dialogs were not exercised in the desktop app, only in the browser
  build, where they are unavailable by design.

## Phase 4.5: model gallery (done in development)

- A versioned, Zod-validated registry manifest shipped with the app, and an
  update fetched only on request, used only when newer, kept offline
- A Discover gallery: search, categories, hardware, source and sort filters,
  grid and list, cards with one honest status each
- Model details: overview, variants and files, four separate compatibility
  questions, presets, installation and technical facts
- Hugging Face as a second source: search with paging, repository details,
  and adding a repository only when an engine in this build can load its
  files, pinned to a commit and installed with the same download manager
- Presets per model, engine and task, applied in the Generate section with
  every setting the engine cannot take reported
- "Use in a scene" from the gallery; a one-click suggestion for Draw Things'
  models folder on macOS, read only and never read before the user adds it

Verified in the development build: the gallery, details, live Hugging Face
search and details, "Use in a scene" with a preset and a real Kokoro run at
that preset's speed, a registry update from a local test server, and a full
install of a 24 MB test model from a local stand-in hub with real progress,
cancelling, a simulated crash and a resumed range request.

Not covered, and carried forward:

- No hosted registry yet; only the copy in the app and test servers were used.
- Only one runtime (Kokoro, PyTorch) can take models from Hugging Face; none
  of the Kokoro forks found there matched its layout.
- Gated models and Hugging Face sign-in.
- Draw Things' models folder was not read during development, at the user's
  request, so that suggestion is untested against a real installation.
- Opening Hugging Face pages from the desktop app (rather than the browser
  build) was not exercised.

## Phase 5A.1: Video DNA Lab foundation (done in development)

- Research projects with reference videos added by YouTube link; only the
  video id is used
- Public metadata and channel details through the YouTube Data API with the
  user's own key, kept in the system's secure storage
- Public top-level comments with paging, search and sorting; authors are not
  stored
- Transcript import from files or pasted text the user may use, with a
  recorded rights statement
- Manual entry of details when there is no key or no connection
- Rule-based findings (facts, language, transcript length and timing,
  comment topics, questions, mentioned moments) with evidence, method and
  limits; the user's own notes with cited evidence
- Coverage report of what was collected, what is missing and what no public
  source offers; data older than 30 days is marked for refresh
- Contracts for a local language model and for grounded AI findings

Verified in the development build against a stand-in API with the real API's
error shapes; the client was also checked against the real API's answers to
an invalid key and to no key. Not covered: a live run with a valid key, which
needs the user's own key; secure key storage on Windows (session only) and
Linux (written, untested).

## Phase 5A.2: local language model (done in development)

- llama.cpp's server started and stopped by Framebop (no other app), on
  loopback with a per-start key, with GGUF models from the Model Manager, a
  memory budget and unloading after every job
- Six analyses (hook, narrative, pacing, audience, concepts, language) run as
  a job with real progress and cancellation, validated against the collected
  evidence, saved and marked stale when the research changes

Verified with a real model (see [video-dna.md](video-dna.md)). Not covered:
bundling llama.cpp (Phase 6), Windows and Linux runs, models larger than the
1.5B one verified.

## Phase 5A.3: Story Architect (done in development)

- Concepts developed into editable outlines and scene scripts by the local
  model, section by section, with approved scenes protected, revisions and
  restart recovery
- Review of originality, facts to check, timing and gaps before production
- A transactional, single-use hand-off to a production project with draft
  scenes, opened in the editor; no media is generated

## Phase 5B.1.5: interface languages (done in development)

- English, Spanish, Brazilian Portuguese, Turkish and German, following the system's
  preferred languages or a choice in Settings, switched without a restart
- Translate engine-written messages (preflight, notices, engine
  descriptions) through structured codes; they are English for now

## Phase 5B.1: Production Blueprint (done in development)

- Word budgets, scene-by-scene writing with continuity summaries, length and
  repetition review, guarded lengthening of short sections
- A production plan per scene, production methods from real engine
  availability, a preflight separating technical, media and editorial issues
- Narration timing from measured Kokoro audio; longer narration suggestions

## Phase 5B.2A: native 2D animation engine (proof of concept, done in development)

- A deterministic scene graph rendered inside the Remotion composition:
  parallax layers, procedural vector props, a keyframed camera that follows
  a character, and environment motion
- Articulated characters with IK legs and arms, a distance-driven walk with
  planted feet, reach, surprise, talk and gesture clips, and mouths that
  follow the narration's loudness
- An original Roman street demo, applied from the Production Blueprint; the
  layered-2d method is available
- Next: painted image layers and cutout characters made of image parts, so
  the same rig can drive illustrated art

## Phase 5B.2B: animation quality (done in development)

- A configurable walk style: heel strike and toe-off with the contact point
  locked, pelvis bounce, shoulder and pelvis twist, elbows and hands that
  follow through, a delayed head
- Sprite characters made of pictures on the existing skeleton, drawn by SVG
  or by a PixiJS (WebGL) renderer inside the same Remotion composition
- A frame-accurate animation preview in the Blueprint
- Next: production artwork in place of the test art, turning and
  three-quarter views, phoneme mouth shapes

## Phase 5B.2: scene media production (partly verified)

- A Media Production panel for each scene in the Blueprint: method, engine
  and model, an editable prompt, a negative prompt and a seed only where the
  engine takes them, a starting image, output size, clip length
- Adapter capabilities say whether an engine accepts a starting image
  (image-to-image, image-to-video), a negative prompt and a seed, how long its
  clips can be and what files it writes; anything else is refused, not dropped
- Generation phases on every job: queued, preparing, loading model,
  generating, validating; one generation of a kind per scene at a time
- Every result is decoded and measured with FFmpeg before it enters the
  library: size, length, frame rate, codec, frame count, and for a clip made
  from a still, the SSIM of its first and last frames against that still. A
  file that fails never reaches the library or the scene
- Every attempt is kept and can be put into the scene; a failure never
  touches the scene's media. A clip shorter than its scene is reported, with
  the option to shorten the scene; since 5B.3 the gap must be covered before
  a video is built
- Visual references: characters, places and styles shared by scenes, whose
  words are added to the prompt and whose approved pictures are offered as
  the starting image, with a seed of their own

Not covered, and carried forward:

- **No real model was run.** There is no image model on the development
  machine and Draw Things' HTTP API was never live. The workflow was verified
  with the test adapter only, which is not evidence of AI quality.
- Image-to-video through `draw-things-cli` (LTX-2.3) remains unrun; the tool
  is not installed.
- Text-to-video has no engine with a verified implementation.
- References keep requests consistent; they do not make a model keep a
  character the same.

## Phase 5B.3: video assembly (done in development)

- Scenes made of several shots: clips with a trim, stills with a length (or
  filling the rest of the scene), and a hold of a clip's last frame only when
  the user chooses it; layered 2D scenes stay one PixiJS or SVG animation
- Media coverage for every scene: the length it needs (its narration
  included), what covers it, and any gap in seconds. A video is not built over
  a gap; the timeline offers adding a shot, a labelled hold, or a shorter scene
- The timeline in Export: one bar per scene showing clips, stills, animation,
  holds and gaps, the shot editor, and subtitle text per scene (timing stays
  approximate and is labelled so)
- Build phases on the render job: preflight, preparing media, composing,
  rendering, verifying; an audio peak check among the output checks
- Verified with the real renderer: an 11 s, 1280×720, 30 fps MP4 from a still
  scene, a scene of a trimmed clip and a still, and a PixiJS scene, with
  narration, music and fades; 330 frames decoded, scene and shot order read
  back from the pictures, source files unchanged

Not covered, and carried forward:

- Rendering only the scenes that changed: every build renders the whole video
- Importing subtitle files and word-level timing
- Sound effects, and generating every missing narration in one step
- The Tauri window itself was not driven; the browser build and the engine
  were

## Phase 5C.1: Scene Doctor (done in development)

- A Scene Doctor workspace that inspects Framebop exports and any video file,
  as a cancellable background job with its own lane; the video is only read
- One streaming FFmpeg pass: black (`blackdetect`), unchanging picture
  (`freezedetect`), silence (`silencedetect`), peaks per 0.1 s (`astats`, in
  floating point), decoder errors from the log; FFprobe for streams, lengths,
  rates and codecs; decoded frame count against length and rate
- Every threshold is a setting with a stated default; every finding has a
  stable id, a time range, measured values, a severity, and up to 40 evidence
  frames taken from the video itself
- With the export's Framebop timeline, planned stills, chosen holds, final
  poses, text cards and scenes without sound are reported as intended, and
  findings are mapped to their scene and shot; without one, what may be
  deliberate is marked for review, never as a defect
- Reports are kept in the library and survive a restart

Not covered, and carried forward:

- No judgement of artistic quality and no repair (Phase 5C.2)
- Decode errors are timed only roughly; clipping is inferred from peaks near
  full scale, since lossy audio rarely reaches 0 dBFS
- In the desktop app, a video outside the library's export folder cannot be
  played inside the app; it opens in the system player instead

## Phase 5D.1: Framebop's own image engine (done in development)

- stable-diffusion.cpp (MIT) as Framebop's image runtime: a pinned official
  build (master-929-3f8527a, macOS arm64), downloaded only with consent,
  checked against its SHA-256 and installed in the library's runtimes folder
  from the Media Production panel; no other application is needed
- An image adapter that runs its `sd-cli` per picture, with prompts passed in
  files, the program's own step counter as progress, and stopping by ending
  the process
- Stable Diffusion 1.5 Q8_0 GGUF in the registry, pinned to a commit and its
  SHA-256, installed through the existing download manager
- Verified: one 512 × 512 picture from the Production Blueprint's Media
  Production panel, 86 s on an M4 Pro (about 20 s of loading), checked,
  attached to its scene and still there after a restart

Not covered, and carried forward:

- Builds for Windows and Linux, and shipping the runtime with the installers
  (Phase 6)
- Image-to-image and larger models

Since then, the slow steps were traced to attention: the adapter now passes
`--diffusion-fa`, and the same 20-step picture takes 24 s (2.4 GB peak
memory) with SSIM 0.999 against the earlier result.

## Phase 5D.2: own voice and writer, simpler steps (done in development)

- sherpa-onnx (Apache 2.0) as Framebop's voice runtime: a pinned official
  build (1.13.8, macOS arm64), with one pinned voice pack per interface
  language (Kokoro v0.19 for English; Piper voices with CC0 recordings for
  Turkish, German, Spanish and Brazilian Portuguese). "Set up voice" in a
  scene installs the runtime and the project language's pack in the
  background; no Python is needed. Piper output is turned down to -1 dBFS.
- llama.cpp's server (MIT) as a pinned runtime (b11361, macOS arm64), used
  whenever no llama-server is chosen in Settings. The Script step's "Write
  with AI" installs it and Qwen3 4B (Apache 2.0, 2.5 GB, reasoning switched
  off) with one consent, writes a draft from a topic in the project's
  language, and puts it into the script only when the user chooses to.
- The Video step leads with one "Make the video" card that plays the
  finished video in place; checks, timeline, settings, earlier videos and
  the manifest moved under "More options".
- Engine progress messages, setting names and render notices are shown in
  the interface language.
- Verified: Turkish and English packs installed through the engine and used
  for narration jobs (5.7 s of speech in 1.1 s; 6.0 s in 3.5 s), attached to
  their scenes; a Turkish script draft written from the Script step in about
  6 s and split into titled scenes. Qwen2.5 1.5B was tried first and wrote
  incoherent Turkish, so the writer uses Qwen3 4B.

Not covered, and carried forward:

- Drafts from a 4B model still need reading: the Turkish draft had a few
  wrong words
- Script writing runs outside the job queue, so it is not kept apart from a
  picture being made at the same time
- Moving clips with AI (now in Phase 5D.3) and shipping the runtimes with
  the installers (Phase 6)

## Phase 5D.3: moving clips with AI (in development)

- A clip engine on the same stable-diffusion.cpp runtime (`-M vid_gen`):
  Wan 2.2 TI2V 5B (Apache 2.0) animates the scene's picture, or makes a
  clip from words alone when there is none. sd-cli writes the frames as PNG
  files and FFmpeg encodes them as an MP4 at 24 frames a second; clips are
  4n + 1 frames and at most five seconds. Progress is the sampler's step
  counter.
- Two registry entries, pinned to a commit and their SHA-256: QuantStack's
  Wan 2.2 TI2V 5B Q4_K_M GGUF with its VAE (4.8 GB) and city96's umt5-xxl
  encoder Q4_K_M GGUF (3.7 GB). The clip engine offers Wan only once the
  encoder is installed too; the picture engine no longer offers either.
- Models made of parts: a catalog entry says which file plays which role
  (a complete checkpoint, or a diffusion model, VAE and text encoders) and
  may name another model as a shared part, installed with it and not
  removable while it is used. Files may come from other repositories, each
  checked at its own commit. The image and clip engines pass each part with
  the sd-cli option its role names and take a model's settings from its
  preset, so a new model of a kind sd-cli runs needs only a catalog entry.
- Repositories of separate weights from Hugging Face (ComfyUI-style or
  GGUF) can be added without a catalog entry: Framebop guesses each file's
  role from its folder and name, the user picks the parts and whether they
  make pictures or clips, sees the size against this computer's memory,
  and only the chosen files are downloaded and verified. One choice per
  repository for now; a second needs the first removed.
- The Movement row of "Make this scene" has a motion prompt, one "Get ready"
  button that installs the runtime and both models with one consent, and
  "Make it move" for a two-second clip that goes into the scene.
- Verified so far with a stand-in sd-cli: setup from the catalog, the job,
  FFprobe's measurement (24 fps, 25 frames) and the clip in its scene.

Not covered yet:

- A real clip on this computer. The models were installed through the
  catalog (10 minutes for 8.5 GB) and a two-second clip (49 frames, 832 ×
  480, 20 steps) was started from a scene's picture on an M4 Pro: loading
  and text encoding took 80 s, sampling 13 minutes (about 40 s a step), but
  decoding the frames with Wan 2.2's VAE kept the GPU at 100 % for over 55
  minutes without writing a frame, so the run was stopped. Peak memory was
  9.8 GB. The clip engine is not usable until decoding is fast: next to try
  are `--vae-conv-direct`, VAE tiling and the TAEHV decoder (a separate
  23 MB download).

## Phase 5: automated episode workflow

- Script generation through a provider interface, with local models first
- Scene planning from a script
- Batch generation of images, clips and narration
- Quality checks, selective regeneration, resuming a failed production

## Phase 6: distribution

- Signed and notarised macOS releases, Windows and Linux installers
- Official Node.js runtime per target with checksum verification
- Third-party licence notices
- Release automation and installation documentation
