# LTX-2.3 MLX Q4: first smoke result

25 October 2026. **Completed with substantial system memory pressure.** This
experiment proves a complete short generation path on the tested machine. It
does not establish comfortable 24 GiB operation or production video quality.

## Environment

| Item                      | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| Hardware                  | Apple M4 Pro, 25,769,803,776 bytes unified memory (24 GiB) |
| OS                        | macOS 27.0.1                                               |
| Python                    | 3.11, independent virtual environment                      |
| LTX core / pipelines      | 0.18.0 / 0.18.0                                            |
| MLX / MLX Metal           | 0.32.2 / 0.32.2                                            |
| mlx-lm / transformers     | 0.31.1 / 5.3.0                                             |
| numpy / huggingface-hub   | 2.4.3 / 1.7.1                                              |
| Runtime revision          | `14a3ddd6054736beb45b4d836135fa4d44490531`                 |
| Video repository revision | `56a5866d638ecfe37c54d348e88938235185c2d4`                 |
| Gemma repository revision | `86cc6a8dedbc456dd0e4af01a9d09f396f77e558`                 |

Package versions were constrained from the runtime's lock file. Only the local
core and inference pipeline packages and their dependencies were installed;
the existing speech environment was not changed. `pip check` passed.

All 31 files in the [selection manifest](ltx-2.3-mlx-q4.files.json), totaling
29,899,425,737 bytes, passed download-time hash verification. The selected local
directories were sufficient for this particular offline run. The selection is
still conservative and is not a proven minimum.

## Configuration and reproduction

The Python API call used the following configuration, with local directories
substituted for the placeholders:

```python
from ltx_pipelines_mlx import DistilledPipeline

pipeline = DistilledPipeline(
    model_dir="VIDEO_PACK_DIRECTORY",
    gemma_model_id="GEMMA_DIRECTORY",
    low_memory=True,
    low_ram_streaming=True,
)
pipeline.verbose = True
pipeline.generate_audio = False
pipeline.generate_and_save(
    prompt="A red ball rolls slowly across a plain wooden table. A fixed camera.",
    output_path="OUTPUT_DIRECTORY/smoke.mp4",
    height=256,
    width=256,
    num_frames=9,
    frame_rate=24,
    seed=42,
    stage1_steps=8,
    stage2_steps=3,
)
```

The child process ran with macOS sandbox networking denied, plus
`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`,
`HF_HUB_DISABLE_TELEMETRY=1`, `DO_NOT_TRACK=1`, and
`TOKENIZERS_PARALLELISM=false`. Hugging Face token environment variables were
removed. No prompt enhancement, intermediate previews, NAG, TeaCache or extra
LoRAs were enabled. Runtime safety/watchdog defaults were retained.

The supervisor used a 600-second deadline and five-second system-memory samples.
Sustained critical pressure for ten seconds would stop the process group.
There was one sampled critical-pressure reading, followed by warning and normal
readings; the stop condition did not trigger. The process exited with code zero,
and no child process group remained. No longer inference run was attempted.

## Measured output and timing

| Measurement                                 |                       Result |
| ------------------------------------------- | ---------------------------: |
| Generation process elapsed (`time -l`)      |                      41.45 s |
| Supervisor elapsed, including polling delay |                      45.37 s |
| Gemma loading, runtime phase log            |                        4.7 s |
| Prompt encoding, runtime phase log          |                        9.6 s |
| Transformer loading, runtime phase log      |                        0.5 s |
| Video decoding, runtime phase log           |                        0.5 s |
| Output                                      | H.264 MP4, 256 × 256, 24 fps |
| Decoded frame count                         |                            9 |
| Duration                                    |                      0.375 s |
| File size                                   |                 14,610 bytes |

Phase logs do not cover every operation, and the transformer-loading label does
not include every later block read under streaming. MP4 encoding time was not
isolated. The total must not be reconstructed by summing only those phases.

FFprobe confirmed dimensions, codec, frame rate, duration and nine decoded
frames. A complete FFmpeg decode exited successfully without decoder errors.
The output SHA-256 is:

```text
ecae2868ca50f92da9f9b1fbc7203cde033a636b1c03afab93cafcdbe6dc929c
```

Visual inspection of frames 0, 4 and 8 found a wooden surface, sky and clouds,
and a changing red ball. The ball is absent from the first sampled frame and
blurred later. Motion is visible, but nine low-resolution frames do not establish
realistic rolling, temporal consistency or satisfactory prompt adherence.

## Memory: the limiting result

| Measurement                               |                           Result |
| ----------------------------------------- | -------------------------------: |
| Process peak memory footprint (`time -l`) | 15,673,420,600 bytes (14.60 GiB) |
| Process maximum resident set size         |   3,996,368,896 bytes (3.72 GiB) |
| System swap before                        |          1,172.88 MiB (1.15 GiB) |
| Highest sampled system swap               |         10,107.44 MiB (9.87 GiB) |
| System swap after                         |          9,787.25 MiB (9.56 GiB) |
| Net system swap increase                  |          8,614.37 MiB (8.41 GiB) |

RSS alone materially understates this run's memory impact. The footprint,
compressed/swapped pages and system pressure must be considered together. The
measurements overlap and must not be added.

The final `mx.get_peak_memory()` returned 2,997,529,546 bytes, but upstream resets
the peak counter inside its decoder. This is decode-phase information, **not**
the whole-run Metal peak. Whole-run peak Metal allocation was not measured.

The machine already reported memory pressure level 2 at the start. Other
applications were not isolated or closed for the experiment. Swap is a global
system measurement, so the increase cannot be attributed exclusively to LTX.
This is a first run in a new runtime environment, not a rigorously cold filesystem
cache benchmark or an isolated-system performance baseline.

## Decision

- The basic generation path works: local files, Metal, sampling, VAE decode and
  MP4 encoding all completed. The previously documented Wan decode stall did
  not occur in this much smaller, different workload; this is not a controlled
  quality or speed comparison between the models.
- Treat the result as **functional with memory-pressure limitations**, not as a
  supported production preset. Application integration is not ready for release.
- Before any longer clip, investigate prompt-encoding/connector memory and repeat
  only the same small configuration in a quieter system session. Capture an
  uninterrupted Metal peak across phase resets. Keep the same model revisions,
  parameters and default safety settings so the comparison remains meaningful.
- Only after acceptable memory behavior should a separately approved 25-frame
  run be considered. Do not extrapolate this result to 480p, long clips, other
  Apple chips or concurrent image, speech and language-model jobs.

Raw logs, package freeze, validation JSON and the generated video remain in the
ignored local benchmark directory. Model weights, environment files and personal
paths are not included in Git. The application and production library were not
opened or modified by this benchmark.
