# LTX-2.3 MLX Q4: independent benchmark preparation

Status: one independent smoke run completed on 25 October 2026. The selected
weights were downloaded and hash-verified, and the pinned runtime was installed
in a separate environment. The tested machine is an Apple **M4 Pro** with 24 GiB
unified memory. See the [measured result](ltx-2.3-mlx-q4-result.md): a nine-frame
clip completed, but substantial system swap growth prevents a claim of
comfortable operation. Longer clips and application integration remain untested.

## Question and scope

Can a short LTX-2.3 clip complete text encoding, sampling, VAE decoding and MP4
encoding on this hardware without excessive memory pressure or an impractical
delay? Completing sampling alone does not answer that question.

Run the experiment outside the application, in a dedicated environment and
output directory. Do not open the production library, change its database, add a
production adapter, or register this candidate as a runnable model. The existing
image, narration and Remotion workflows remain the application baseline.

## Pinned candidates

The accompanying [file manifest](ltx-2.3-mlx-q4.files.json) records public Hub
metadata: repository commits, file sizes and SHA-256 or Git blob digests. It is
research data, not the application's model catalog and not an installer.

| Component    | Repository                                                                                                                                  | Revision                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Runtime      | [dgrauet/ltx-2-mlx](https://github.com/dgrauet/ltx-2-mlx/tree/14a3ddd6054736beb45b4d836135fa4d44490531)                                     | `14a3ddd6054736beb45b4d836135fa4d44490531` |
| Video pack   | [dgrauet/ltx-2.3-mlx-q4](https://huggingface.co/dgrauet/ltx-2.3-mlx-q4/tree/56a5866d638ecfe37c54d348e88938235185c2d4)                       | `56a5866d638ecfe37c54d348e88938235185c2d4` |
| Text encoder | [mlx-community/gemma-3-12b-it-4bit](https://huggingface.co/mlx-community/gemma-3-12b-it-4bit/tree/86cc6a8dedbc456dd0e4af01a9d09f396f77e558) | `86cc6a8dedbc456dd0e4af01a9d09f396f77e558` |

Use `transformer-distilled.safetensors` for this baseline, rather than silently
substituting the dev or distilled-1.1 transformer. A different transformer is a
different experiment.

The video selection conservatively includes every component declared by the
split pack, its configuration files and license, but only one transformer. This
includes audio components, the image encoder and auxiliary upscalers even though
the first experiment disables audio output and has no image input. Whether each
can be omitted must be checked against the pinned loader before narrowing the
selection. Additional LoRAs and alternate transformers are excluded. Dependency
closure has **not** been verified; the manifest is not a proven minimum.

| Selected files                       |              Bytes | Decimal GB |
| ------------------------------------ | -----------------: | ---------: |
| Video pack candidate                 |     21,831,406,005 |      21.83 |
| Text encoder, tokenizer and metadata |      8,068,019,732 |       8.07 |
| Total                                | **29,899,425,737** |  **29.90** |

The total is about 27.85 GiB of selected file content. It excludes Python,
runtime dependencies, package caches, temporary files and outputs. Reserve at
least 40 GiB of free disk space as a planning allowance, then revise it after
environment preparation; this is not an upstream minimum. Hub caching and copies
can increase disk use. These disk figures are **not** a peak RAM estimate.

Q4 quantization applies to transformer block Linear weights, not the entire
pipeline. The connector alone is 6,344,495,512 bytes, and the text encoder is a
separate model. A short, low-resolution clip reduces activation memory but does
not remove model-loading costs.

## Requirements to resolve before execution

1. Review the pinned runtime's dependency lock and supported Python/macOS/MLX
   versions. Upstream declares Python 3.11+; do not reuse a speech environment
   without checking dependency compatibility. Capture the complete resolved
   environment for reproduction.
2. Review the runtime code license, LTX weight license, and Gemma's separate
   terms and provenance. Retain the relevant notices. Framebop's Apache-2.0
   license does not relicense third-party weights. Do not commit or redistribute
   weights with this preparation.
3. Resolve the chosen pipeline's full dependency closure, including config,
   tokenizer, upscaler and any implicit fallback downloads. Obtain explicit
   approval for the final installation and download list before acquiring it.
4. Validate downloaded files against the manifest. A `git-blob-sha1` digest
   hashes `blob <byte-length>\0` followed by the content; it is not a plain
   content SHA-1. File hashes here are reported by the Hub, not locally verified.
5. Pass local model and encoder directories explicitly. Verify the pinned loader
   honors offline loading, enable the applicable offline settings, and deny
   network access for inference so a missing file fails visibly.
6. Confirm local FFmpeg/FFprobe availability and the actual chip, total memory,
   macOS version and free disk space. Stop other model jobs and renders.

The upstream port advertises int4 support on 16 GB machines, but that is not a
measured result for this experiment. Shared system/GPU memory, text encoding,
attention activations, decoding and allocator caches all affect the actual peak.

## First run

| Setting           | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Input             | Text only                                                                  |
| Prompt            | `A red ball rolls slowly across a plain wooden table. A fixed camera.`     |
| Seed              | `42`                                                                       |
| Output            | 256 × 256, 9 frames, 24 fps                                                |
| Mode              | Distilled, 8 stage-one steps and 3 stage-two steps                         |
| Memory            | Block streaming (`--low-ram`); default safety/watchdog settings            |
| Audio             | Disable audio decoding and muxing                                          |
| Optional features | No prompt enhancement, intermediate previews, NAG, TeaCache or extra LoRAs |
| Deadline          | 10 minutes total, including model loading                                  |

This is a proposed smoke configuration; the pinned pipeline must accept it
before it becomes a benchmark command. LTX uses an `8n + 1` frame grid. Nine
frames at 24 fps occupy about 0.375 seconds in the encoded file. Disabling audio
output does not necessarily eliminate joint audio-latent computation.

Keep separate measured timings for model loading, text encoding, both sampling
stages, VAE decoding and MP4 encoding. Report only timings the runtime exposes
or the harness measures; mark unavailable phase timings as unknown.

Capture peak process RSS, MLX/Metal peak allocation where available, baseline and
final swap usage, memory pressure, total wall time and exit status. RSS and Metal
allocations may overlap in unified memory and must not be added together.
Record a deadline or memory-pressure stop as an incomplete run, never a pass.
Terminate the process group at the deadline, then check for surviving children.

## Acceptance and reporting

- The process exits successfully before the deadline and writes an MP4.
- FFprobe reports the requested dimensions, frame rate and nine decoded frames.
- FFmpeg decodes the complete video without errors.
- First, middle and last frames are inspected for blank output and corruption;
  record whether the requested movement is visible.
- Memory measurements and any swap growth are reported. A completion that
  depends on heavy swapping is a constrained result, not evidence of comfortable
  24 GB operation.

Publish a small report containing the pinned revisions, software environment,
hardware, exact arguments, input/seed, measured timings, memory observations and
validation results. Avoid personal paths, credentials or recordings in shared
logs. Report cold-start behavior separately; do not infer sustained performance
from this single run.

Only after the smoke run passes, propose one 25-frame run at the same resolution
and seed. Neither result establishes production quality, 480p performance or
support for longer clips. If loading or decoding fails, investigate that phase
before increasing output size or adding application UI.

## Integration gate

After an acceptable independent result, reuse `VideoGenerationAdapter`, the
production queue, managed model storage, scratch output validation and the
existing render pipeline. First address the shared memory exclusion gap: script
writing, Animation Director and voice previews currently bypass the production
lane. Add per-phase progress, a deadline, process cleanup and model-specific
frame/parameter validation before offering real runs.

## Sources

- [Runtime README at the selected revision](https://github.com/dgrauet/ltx-2-mlx/blob/14a3ddd6054736beb45b4d836135fa4d44490531/README.md)
- [Pipeline behavior and memory controls](https://github.com/dgrauet/ltx-2-mlx/blob/14a3ddd6054736beb45b4d836135fa4d44490531/docs/PIPELINES.md)
- [CLI defaults and argument handling](https://github.com/dgrauet/ltx-2-mlx/blob/14a3ddd6054736beb45b4d836135fa4d44490531/packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/cli.py)
- [Video pack metadata](https://huggingface.co/api/models/dgrauet/ltx-2.3-mlx-q4/revision/56a5866d638ecfe37c54d348e88938235185c2d4?blobs=true)
- [Text encoder metadata](https://huggingface.co/api/models/mlx-community/gemma-3-12b-it-4bit/revision/86cc6a8dedbc456dd0e4af01a9d09f396f77e558?blobs=true)
