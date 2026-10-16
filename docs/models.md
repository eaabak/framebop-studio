# Models

The **AI Models** tab is a gallery of the models Framebop Studio can install,
a window onto Hugging Face, and the place to see what this computer can run.
How it works inside is described in
[architecture.md](architecture.md#model-manager); the registry's format is in
[registry.md](registry.md).

## Three separate questions

For every model the tab answers three questions, and never folds them into
one:

| Question   | "Yes" means                                                              |
| ---------- | ------------------------------------------------------------------------ |
| Installed  | Every file is on disk and matches the hash its publisher recorded.       |
| Compatible | This computer meets every requirement the publisher states.              |
| Runnable   | An engine in this version of Framebop Studio can load and run the model. |

Compatibility is **unknown**, not "yes", when the publisher states no
requirements and nobody has tested the model on this kind of computer. A
recorded test run on the same operating system and architecture counts, in
both directions. A smaller download never makes a model "fit".

Each gallery card sums this up in one status, decided by the engine:

| Status                      | Meaning                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Ready to Use                | On this computer (installed or found elsewhere) and an engine can run it now.          |
| Installed — Runtime Missing | Installed and verified, but no engine can run it now; the details say what is missing. |
| External Installation       | Found in a folder you added, read only, but not runnable now.                          |
| Downloading                 | Being downloaded; the card shows the real percentage.                                  |
| Verification Failed         | The files on disk do not match their published hashes.                                 |
| Compatible — Not Installed  | Meets its stated requirements, or was tested on this kind of computer.                 |
| Compatibility Unknown       | Not yet tested here, and its requirements are not stated.                              |
| Insufficient Resources      | This computer does not meet a stated requirement, or a test here failed.               |
| Unsupported                 | No engine in this version can run it at all.                                           |

"Ready to Use" is never shown because files exist: an engine must accept
them.

## Discover

**Framebop Verified** is the registry: models reviewed by the maintainers.
Search by name, family, capability or provider; filter by category, by
hardware (ready now, not ruled out, hide unsupported) and by source (the
registry, or models you added from Hugging Face); sort by recommendation,
name, size or when the metadata was last checked; switch between a grid and
a list.

Model cards carry no thumbnails: repositories offer none that can be trusted,
so each card shows its category on a colour belonging to its family.

A model's details show its overview, licence and repository; its variants and
files; four separate compatibility questions (can an engine load these files,
is that engine's runtime set up, does the hardware meet the stated
requirements, has it been tested on this kind of computer); its presets; what
installing involves, including any copy already on this computer; and the
technical facts: commit, hashes, runtime and ownership.

**Check for registry updates** fetches a newer registry from the address in
Settings. No hosted registry is published yet.

## Hugging Face

**Hugging Face** in the source switch searches huggingface.co: by text, by
task, sorted by downloads, likes, trend or date, a page at a time. Only
metadata is requested; nothing is downloaded. A repository's page shows its
files, sizes, licence as declared, access and commit.

Most repositories cannot run in Framebop Studio, and the page says so: "Model
found, but no compatible Framebop runtime is available." A repository is
offered as **Add to my models** only when its files match the layout an
engine in this build loads (today, Kokoro-82M's PyTorch release: config,
weights and English voices). Adding it pins it to the commit you looked at,
with the hashes the Hub reported, and downloads nothing; it then appears
among your models, marked as imported and not reviewed, and installs like any
other. Gated repositories are never offered. No code from a repository is
ever run.

Searching sends your words to huggingface.co. If it cannot be reached, the
page says so, and everything else keeps working.

## The catalog

Framebop Studio offers only models that have been checked by hand. Each entry
is pinned to one commit of a Hugging Face repository and lists exactly the
files that variant needs, with their sizes and hashes, so the files you get are
the ones that were checked. Entries record when they were last compared with
Hugging Face.

| Model                     | Task           | Download | Format      | Licence                 | Runnable in this version |
| ------------------------- | -------------- | -------- | ----------- | ----------------------- | ------------------------ |
| Kokoro 82M, ONNX 8-bit    | Speech         | 92.9 MB  | ONNX        | Apache-2.0              | No                       |
| Kokoro 82M                | Speech         | 327.7 MB | PyTorch     | Apache-2.0              | Yes, with Kokoro\*       |
| LTX-2.3 22B Distilled 1.1 | Image to video | 46.1 GB  | safetensors | LTX-2 Community License | No                       |

\* When a Python interpreter with the `kokoro` package is chosen in Settings.
The same model already in your Hugging Face cache works too: add the cache in
**Models → Installed**.

Sizes here are decimal megabytes and gigabytes. The application counts in
binary units (1 MB = 1,048,576 bytes), so it shows 88.6 MB for the first model
and 43.0 GB for the last.

The LTX-2 licence requires organisations with annual revenue of US$10 million
or more to obtain a separate commercial licence from Lightricks. The app shows
each model's licence, with a link to the full text, before it downloads
anything. Read the full text before using a model.

## Using a model

**Use in a scene**, on a model that is ready, opens the Scenes tab with the
right task, engine and model chosen in the selected scene's Generate section.

### Choosing a model for a scene

In a scene's **Generate** section, an engine that needs a model shows a model
picker instead of a text field. It is searchable and lists:

- **On this computer**: models the engine offers itself, models Framebop
  downloaded, and files found in folders you added, that this engine can use.
- **Download**: catalog models that are not installed yet. Choosing one opens
  the usual download confirmation. Those the engine could not use even after
  downloading are shown dimmed, with the reason.
- **Cannot use**: files that were found but that this engine cannot load, each
  with the reason. Collapsed by default.
- **Use “…”**: what you typed, for a model the engine already has under that
  name, such as a file in Draw Things' own models folder.

**Manage models** opens the Models tab, and **Add a folder with models** adds
a read-only folder without leaving the scene.

A file found in an added folder is passed to Draw Things' command-line tool
together with its folder, so files a model depends on (text encoders, VAE)
are found next to it. This has not been tried with the real tool yet. The
engine accepts a file path only if the picker offered it for that engine.

## Downloading

Choosing **Download** shows the size, the number of files, the repository and
commit, the free space where models are stored, the licence, and whether an
engine could use the model once installed. Nothing is fetched until you
confirm, and nothing is ever downloaded when the application starts.

While it runs, the **Downloads** section shows the bytes actually received and
the measured speed. One model downloads at a time; others wait their turn.

- **Cancel** stops the download and deletes what it fetched.
- If the connection drops, or the application quits or crashes, the download
  is marked failed or interrupted and what was received stays on disk.
  **Resume** checks those bytes again and asks the server only for the rest.
  Nothing resumes on its own.
- **Discard** deletes the partial files and forgets the download.
- A file whose hash does not match is deleted and never counted as installed.

**Check files** on an installed model hashes every file again. Use it if you
suspect the files were changed or damaged.

## Where models are stored

By default, in `models/` inside the library folder (see
[Where your data is stored](../README.md#where-your-data-is-stored)). **Change
location** in the Installed section picks another folder for new downloads.
Models that are already installed stay where they are.

Each model gets its own folder, named after its installation, with a
`.framebop-model.json` file that marks it as Framebop's.

## Removing a model

**Remove** deletes the files that were downloaded for that model, and nothing
else. If you put other files in its folder, they and the folders holding them
are left in place. Copies of the model anywhere else on the computer are never
touched.

## Models found elsewhere

**Add folder** lets Framebop Studio look into a folder where another
application keeps its models, and **Add Hugging Face cache** does the same for
the cache used by Hugging Face's own tools, when this computer has one. These
folders are **read only**: their files are listed, never changed, moved, copied
or deleted. **Stop watching** removes a folder from the list and deletes
nothing.

Only folders you add are looked at. Framebop Studio does not search your disk.
A scan lists files ending in `.safetensors`, `.ckpt`, `.gguf`, `.onnx`, `.pth`
or `.pt` that are at least 1 MB, up to four folders deep. A file is shown as
the same as a catalog model only when that is certain: the same repository,
commit and file sizes in a Hugging Face cache, or the same file name and size
in a folder.

On macOS, **Add Draw Things models** adds Draw Things' own models folder in
one click. Nothing in it is read before you click, and macOS may ask whether
Framebop Studio may access Draw Things' data. Its files are Draw Things' own
format: they are listed, and only the Draw Things command-line engine can be
given them. They are never matched to registry models, because how Draw
Things converts and names its files is not documented.

When a registry model is already on this computer, for example in the
Hugging Face cache, its details say so and installing it asks whether you
really want a second copy.

## Hardware

The **Hardware** section shows what was detected: operating system, processor,
memory, graphics processors with their memory, free space where models are
stored, and which compute back ends (CPU, Metal, CUDA, ROCm) are available. It
also lists what could not be determined, and why. **Detect again** refreshes
it.

Values are read from the operating system's own tools, never guessed:

- **Apple Silicon** GPUs share the system's memory. There is no separate video
  memory figure, so none is shown.
- **NVIDIA** GPUs are read with `nvidia-smi` when it is installed, on any
  platform. Its absence means CUDA is reported as unavailable, not that the
  computer has no NVIDIA GPU.
- **Windows** reports other graphics cards without a reliable memory size, so
  their memory is shown as not reported.
- **Linux** graphics cards are listed with `lspci`, which reports no memory.

Only the macOS detection has been run on a real computer. The Windows and Linux
paths are tested against recorded tool output and have not been run on those
systems.

## What is not done yet

- **Only the PyTorch release of Kokoro can be used**, by the Kokoro engine,
  through a Python you provide. The ONNX release has no engine yet; LTX-2
  needs a runtime of its own. The Draw Things command-line engine only loads
  Draw Things' own `.ckpt` files, so it does not accept these downloads.
- **Gated models** (those that need a Hugging Face account and the publisher's
  approval) are shown but cannot be downloaded. Supporting them needs an
  access token kept in the operating system's secure storage, which is not
  built.
- Models an engine already has, such as those inside Draw Things, are listed
  only once their folder is added, and Draw Things' own files cannot be
  matched to registry models.
- Only one runtime (Kokoro, PyTorch) can take models added from Hugging Face.
