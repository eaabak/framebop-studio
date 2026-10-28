# Local LTX video

Framebop uses the LTX-2.5 distilled MLX Q4 split pack on Apple Silicon. The
**Scenes → Make this scene → Video studio** panel shares the existing production
queue, asset library, validation and export renderer. The engine is experimental.
Model downloads and generation require explicit user actions.

## Video controls

- Silent H.264 clips, 1–10 seconds, generated at 24 fps. Optional finishing
  produces 1080p and/or interpolated 60 fps clips. The initial duration is ten
  seconds, but shorter clips are the appropriate first hardware check.
- Fast (640×384), Balanced (768×512), High (1024×576, default), Highest
  (1280×704), Ultra (1408×768). Portrait presets swap width and height.
- These quality presets change spatial resolution and processing load. The
  distilled schedule stays at 8+3 steps; extra steps are not a quality slider.
- Editable prompt, optional seed, local model choice and first-frame strength.
- Text-to-video or image-to-video with one approved starting image.
- Saved character, environment and style references; linked descriptions join
  the prompt, and their images are available as first-frame anchors.
- Real sampler progress, decoding/encoding stages, cancellation and result history.

There is no generation time limit by default (`timeoutSeconds: 0`). The advanced
panel can opt into ten or twenty minutes. The deadline covers generation,
decoding and the single encoding pass. Cancellation terminates the Python process group, escalating to SIGKILL
if it does not stop within five seconds. Sustained critical system memory
pressure also stops generation. A failed job does not replace scene media.

Each run starts a fresh Python process and frees model memory afterward. The
adapter uses local paths, Hugging Face/Transformers offline mode and blocked
Python socket connections; it does not receive Hub token environment variables.
It does not download weights or install packages during generation.

## Runtime setup

Python is user-managed in a dedicated environment. The app does not install or
upgrade that environment. The tested runtime is Python 3.11 on macOS 27.0.1;
the selected MLX prebuilt wheel targets macOS 26 or newer.

1. Obtain [dgrauet/ltx-2-mlx at the tested commit](https://github.com/dgrauet/ltx-2-mlx/tree/14a3ddd6054736beb45b4d836135fa4d44490531).
2. Install its `packages/ltx-core-mlx` and `packages/ltx-pipelines-mlx` using the
   accompanying [version constraints](ltx-runtime-constraints.txt). The adapter
   requires both packages at 0.18.0, MLX 0.32.2 and mlx-lm 0.31.1; its progress
   hook is tied to that runtime. The training package is unnecessary.
3. Install FFmpeg and FFprobe with H.264 encoding support.
4. In **Settings → Engines**, select **Video: Python with LTX MLX**.

For example, with the source checkout named `ltx-2-mlx` and the constraints file
copied alongside it:

```bash
python3.11 -m venv ltx-environment
ltx-environment/bin/python -m pip install \
  --constraint ltx-runtime-constraints.txt \
  ./ltx-2-mlx/packages/ltx-core-mlx \
  ./ltx-2-mlx/packages/ltx-pipelines-mlx
ltx-environment/bin/python -m pip check
```

These are setup instructions, not commands run automatically by Framebop.

## Model pack and access

The registry pins `dgrauet/ltx-2.5-mlx-q4` at commit
`e9a20add8c5937fcab635fb8e7a52926487a5776`. Its conservative distilled subset has
23 files totaling 30,236,533,040 bytes. Each file has a recorded SHA256. The full
repository also contains a dev transformer and optional LoRA/upscaler weights
that are not required for this preset.

This repository requires Hugging Face access approval. Review and accept the
conditions yourself on the [model page](https://huggingface.co/dgrauet/ltx-2.5-mlx-q4),
then authenticate a Hugging Face downloader locally. This version of Framebop’s
Model Manager does not download gated repositories. Download the registry’s file
subset with authenticated tools, then choose the local model folder in Settings
or Video studio. Do not share a token in project files, prompts or issue reports.

The pack contains its own Q4 **Gemma 4** text encoder. A separate Gemma 3 directory
is not used. Format checks require the 2.5 configuration, Q4 metadata, compatible
Gemma 4 configuration, transformer, connector, conv VAE, spatial upscaler and
tokenizer files. An arbitrary safetensors file or an old 2.3 pack is rejected.
The old text-encoder setting is retained only for saved-settings compatibility.

Model weights retain their upstream LTX-2.x Community License; Framebop’s
Apache-2.0 license does not relicense them. The registry links to the model terms.
Model weights, environments and personal paths are never committed.

## Character references

Create a named project reference with a stable description, optional palette and
seed. **Upload a reference picture** copies a supported image of up to 25 MiB
into the project library without replacing scene media. Cross-project images
cannot be linked. Linking a reference with an image offers it as the first-frame
anchor; **From words** clears that anchor but keeps the linked descriptions.
The selected image is shown explicitly. One image is used at a time.

This preset does not provide identity embeddings, multi-image conditioning,
negative prompts, LoRA training or guaranteed character anatomy. A starting
image anchors composition as well as appearance; choose one close to the shot
and orientation you want. Unwanted lettering can still occur, even with a clean
reference and a prompt requesting no text.

## Formats and export

**Video format** appears in Video studio and export settings, sharing the existing
workspace-wide export setting:

- YouTube / landscape: exact 1920×1080 (16:9), with 1280×720 also available.
- Instagram / Shorts / portrait: exact 1080×1920 (9:16).

Portrait frames are generated natively rather than rotating a landscape clip.
Native dimensions follow the model’s 64-pixel grid, so some approximate the
selected ratio; the existing renderer uses a centered crop to fill the exact
output canvas. Existing clips are not regenerated when format changes and can
crop substantially if their orientation differs. Export fps remains a separate
control. Enlarging a clip for 1080p export does not create native 1080p detail.

LTX generates `8n+1` frames; the version-bound conv VAE sink trims surplus
decoded frames before encoding once at H.264 CRF 16 and 24 fps. Frames are streamed
without retaining the complete decoded clip. This avoids an intermediate CRF 18
file and a second lossy encode. It does not accelerate diffusion or create detail
the model did not generate. Compressed-packet stream copying is deliberately not
used for trimming: reordered H.264 frames can change the last decoded frame.
A missing sink hook or short decoded stream fails the job; existing asset
validation remains the final acceptance check. No interpolation is applied. Results pass the existing decode/metadata checks
before adoption. Previously selected video is retained until a new result is used.
The text-to-video scene method uses the existing append-only database migration.

## Hardware evidence and limitations

An independent LTX-2.5 Q4 reference-image run produced 384×640, 72 output frames,
three seconds at 24 fps in 116.95 seconds on M4 Pro / 24 GiB. Whole-run Metal
allocation peaked at 16,223,772,796 bytes. System memory pressure stayed normal,
but swap rose from 785 MiB to 4,895.38 MiB. These are distinct measurements, not
an assertion that total process or system memory equals Metal allocation.

A subsequent end-to-end reference-image job through the production queue
completed 704×1280, three seconds / 72 frames at 24 fps in about 418 seconds.
Loading, sampling, decoding/encoding, validation and asset adoption all completed.
Sampled frames showed no unwanted lettering. This is one example, not a guarantee
that all prompts or seeds avoid lettering or anatomical artifacts.

These tests do not establish fit or speed at every larger size or ten seconds. Lower resolution/duration if memory pressure is excessive. Production
work is serialized with image/audio generation and rendering; external writer
calls and voice previews also hold model memory exclusively.

The earlier [LTX-2.3 benchmark](benchmarks/ltx-2.3-mlx-q4.md) is historical evidence
for another model and is not an LTX-2.5 performance claim. Checkpoint resume is not
implemented; interrupted inference must start over. Removing obsolete model
weights is a separate explicit maintenance action and never happens automatically
when settings change. Existing assets, exports and job history are retained.

## Quality and performance strategy

Keep expensive model stages sequential: generation first, spatial enhancement
second, optional frame interpolation last. Release each model process before the
next stage. Avoid keeping Gemma, the diffusion transformer and an enhancement
model resident together on a 24 GiB machine. The pinned pipeline already frees
the text encoder before sampling and the transformer before VAE decoding; retain
its low-memory streaming and automatic decode tiling. More sampler steps and
TeaCache are not validated quality/performance controls for this 2.5 preset.

For iteration, use a clean reference, a fixed seed, one simple motion and a short
clip. Compare resolutions with the same prompt/reference/seed before increasing
production duration. A spatial upscaler may simplify fine textures or introduce
flicker; inspect the full motion as well as still crops. A 60 fps interpolated
export improves apparent fluidity, not source drawing detail. Preserve the
original asset and make enhancement an explicit, optional derivative.

An isolated reference-conditioned 768×1408 / three-second test completed in
487.44 seconds. System swap rose from 3,391 to 7,817 MiB, with one critical-pressure
sample; this is evidence of significant memory contention, not comfortable fit.
A subsequent sequential Real-ESRGAN MLX anime-video enhancement to 1080×1920 took
61.39 seconds, peaking at about 1.14 GB Metal allocation. This single example
establishes feasibility, not temporal consistency or universal quality gains.
Enhancement and 60 fps interpolation are now explicit, opt-in Video studio
controls. Their visual quality remains experimental. Additional weights retain their own
licenses and must not be bundled under Framebop's license without review.

## Optional 1080p / 60 FPS finishing

Video studio offers independent **AI enhancement to 1080p** and **60 FPS motion
interpolation** controls, both off by default. Choosing 60 FPS also selects the
shared 60 FPS export setting. Export FPS alone does not synthesize motion in
other 24 FPS assets. Source generation still uses the selected native resolution
and 24 FPS; finishing is not native 1080p/60 model inference.

For AI enhancement, install the separately licensed Real-ESRGAN MLX runtime in
the same Python environment selected for LTX. The tested source is
[xocialize/realesrgan-mlx at 52c0fc1](https://github.com/xocialize/realesrgan-mlx/tree/52c0fc1044277900b995308095a1f3cc484a3581),
package version 0.1.0. With a reviewed local checkout and the existing LTX
runtime dependencies, installation can use:

```bash
ltx-environment/bin/python -m pip install --no-deps ./realesrgan-mlx
```

Download `model.safetensors` from
[mlx-community/Real-ESRGAN-animevideov3](https://huggingface.co/mlx-community/Real-ESRGAN-animevideov3/tree/e5ef3093b04690351f65dde6e0a7118a73b68360).
In **Settings → Engines → Real-ESRGAN MLX weights folder**, choose its containing
folder. The file is 1,247,050 bytes and must have SHA256
`c023b38444ac2b54642126c75054abb5e0b27d0a460eca563757d974fe18e089`.
Other weights or unconverted PyTorch checkpoints are rejected. Runtime and
weights remain separate user installations under their BSD-3-Clause terms;
Framebop does not bundle, download or install them automatically.

The adapter checks weights/runtime and FFmpeg's `minterpolate` filter before
starting LTX. After the LTX process exits, a separate offline process enhances
frames with `realesr-animevideov3`, using 256-pixel tiles with 16-pixel context.
It resizes and centrally crops to 1920×1080 or 1080×1920. Only after that process
exits does FFmpeg motion-compensated interpolation produce 60 FPS. Enhancement
can smooth textures or flicker, and interpolation can distort limbs and edges.
Inspect full motion before publishing. These are optional creative tradeoffs.

Each finishing stage has a separate twenty-minute limit and supports cancellation.
Sustained critical memory pressure also stops the enhancement process. Queue
serialization continues to reserve model memory until all finishing ends. The
job retains source/finishing metadata, and its promised dimensions, FPS and
frame count are verified before adoption. A failed finishing stage fails the
job rather than silently delivering an unfinished variant. Existing scene media
is kept; temporary native and intermediate clips are cleaned with the job folder.
The adopted asset is the requested finished variant.

CPU-only bridge tests can be run separately with:

```bash
python3 packages/ai-adapters/tests/test_ltx_encoding.py
```
