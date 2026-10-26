# Local LTX video

Framebop can run the tested LTX-2.3 distilled MLX Q4 split pack on Apple Silicon.
The **Scenes → Make this scene → Video studio** panel uses the existing
production queue, asset library and video renderer. Nothing generates or
downloads automatically. The engine is experimental.

## What the panel controls

- Silent H.264 clips, 1–10 seconds (default: 10), fixed 24 fps.
- 640×384, 768×512, 1024×576 or experimental 1280×704. The default 1K preset is the same size as the
  independently checked fox clip; time and quality depend on the prompt.
- Editable prompt, optional seed, local model choice and generation deadline.
- Words alone, or one starting image with an adjustable first-frame strength.
- Saved project references for characters, environments and styles; their words
  join the prompt and their approved pictures can anchor the first frame.
- Real sampler progress, model loading, frame decoding, encoding, cancellation,
  error history and selection of earlier results.

The preset uses distilled 8+3 steps and low-memory block streaming. It does not
offer a negative prompt, arbitrary step counts, audio generation, LoRA training,
multi-image identity embeddings or a character-identity guarantee. A full-body
picture of a character also anchors the composition: it is not an identity-only
reference. Start with a picture close to the shot you want.

Clips longer than five seconds are experimental and have not been verified on
the 24 GiB test machine. The ten-second default is a product setting, not a
hardware compatibility claim. Reduce duration or resolution if memory pressure
or the generation deadline stops a run.

The 1280×704 preset has approximately 53% more pixels than 1024×576 and is
also unverified on the test machine. It respects the two-stage model’s
64-pixel dimension grid; it is not 720p or a quality guarantee. Combining it
with ten seconds increases workload substantially. The default remains 1024×576.

## Runtime setup

Python is user-managed, in a separate environment. The app does not install or
upgrade packages in an existing environment. The tested setup is Python 3.11 on
macOS 27.0.1; the selected MLX prebuilt wheel targets macOS 26 or newer.

1. Obtain the upstream source at commit
   `14a3ddd6054736beb45b4d836135fa4d44490531` from
   [dgrauet/ltx-2-mlx](https://github.com/dgrauet/ltx-2-mlx/tree/14a3ddd6054736beb45b4d836135fa4d44490531).
2. Create a dedicated virtual environment. Use the accompanying
   [version constraints](ltx-runtime-constraints.txt), exported from the tested
   inference environment, to install the source's `packages/ltx-core-mlx` and
   `packages/ltx-pipelines-mlx` packages. The adapter requires core/pipelines
   0.18.0, MLX 0.32.2 and mlx-lm 0.31.1 because its progress hook is version-bound.
   The training package and all-extras installation are unnecessary.
3. Install FFmpeg and FFprobe, including H.264 encoding support.
4. In **Settings → Engines**, choose **Video: Python with LTX MLX**.

For example, from a directory containing a checkout named `ltx-2-mlx`, with
Framebop's constraints file copied alongside it:

```bash
python3.11 -m venv ltx-environment
ltx-environment/bin/python -m pip install \
  --constraint ltx-runtime-constraints.txt \
  ./ltx-2-mlx/packages/ltx-core-mlx \
  ./ltx-2-mlx/packages/ltx-pipelines-mlx
ltx-environment/bin/python -m pip check
```

These commands are explicit setup instructions, not actions run by the app.
Review upstream code and model terms before installing or downloading.

## Model files

The Model Manager includes **LTX-2.3 Distilled · MLX Q4** and its shared
**Gemma 3 12B · LTX text encoder Q4** dependency. Normal download confirmation,
commit pinning, integrity checks, cancellation and resume apply. Removing a shared
encoder is blocked while a managed model depends on it.

Alternatively, keep existing downloaded files in place:

- Choose **LTX Q4 model folder**, containing the split pack's config,
  `quantize_config.json`, `transformer-distilled.safetensors`, connector, VAE and
  spatial upscaler files.
- Choose **Gemma text encoder folder**, containing its config, weight index,
  shards and tokenizer. Leave this setting empty to use the verified managed
  Gemma installation.

The adapter recognizes complete MLX Q4 split packs, not arbitrary safetensors or
the original full-precision LTX checkpoint. It never downloads missing weights:
local paths, Hugging Face/Transformers offline mode and blocked Python socket
connections make incomplete installations fail visibly. The Python process
does not receive Hub token environment variables.

The conservative model selection is approximately 29.90 GB. Disk size is not a
RAM requirement. The LTX weights and Gemma retain their separate upstream terms;
Framebop's Apache-2.0 license does not relicense them. Model weights, Python
environments and personal paths are not committed to this repository.

## Character references

Create a named character in the panel, give it a stable description and optionally
a palette and seed. **Upload a reference picture** copies a supported image of
up to 25 MiB into the project's library without replacing a scene's picture.
Link the character to any scene of that project. References cannot use assets
from another project.

Selecting a newly linked reference with a picture offers that picture as the
first-frame anchor; **From words** clears the anchor while retaining linked
descriptions. The panel shows which image is sent. One image is used at a time;
additional approved pictures are choices, not simultaneous conditioning inputs.

## Execution and limits

Video work shares the serialized production lane. External writer/director calls
and voice previews hold that lane while using model memory; those calls cannot
start over active generation. Imports and inspection keep their existing lanes.

Each generation is a fresh Python process with an isolated scratch directory.
Cancellation sends SIGTERM to its process group, followed by SIGKILL after five
seconds if needed. The default model deadline is twenty minutes, configurable down to ten; final encoding has a separate one-minute limit. Sustained critical system
memory pressure stops the model. A failed or stopped job never replaces scene
media. In-flight inference is not resumable after shutdown.

LTX generates on an `8n+1` frame grid. Framebop trims the extra generated frames
to the requested duration at 24 fps, without motion interpolation or upscaling.
Results go through the existing decode/metadata checks before asset adoption.
Existing scene video stays selected until the user chooses another result.

A successful standalone M4 Pro / 24 GiB run produced a five-second 1024×576 clip
in about 6 min 39 s. Earlier runs caused significant system swap growth, and other
applications were not isolated. This does not establish guaranteed RAM usage,
performance on all Macs, or flawless character anatomy. See the
[benchmark preparation and first result](benchmarks/ltx-2.3-mlx-q4.md).

The new text-to-video scene method uses an append-only schema migration. Existing
scene plans, references, animation and assembly data are retained, and the normal
pre-upgrade database backup applies.
