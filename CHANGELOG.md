# Changelog

Notable user-facing changes are recorded here. Versions follow SemVer; alpha
versions are development previews. A version listed here does not imply that
installers or a GitHub Release have been published.

## Unreleased — 0.2.0-alpha.1

### Added

- Local LTX-2.5 distilled MLX Q4 video generation on Apple Silicon, with a
  bundled Gemma 4 encoder and optional first-frame image conditioning.
- Video studio controls for 1–10 second clips, native resolution presets,
  landscape/portrait orientation, seed, reference strength and optional deadline.
- Named character/style/environment references with imported pictures.
- Optional sequential Real-ESRGAN enhancement to landscape or portrait 1080p,
  and FFmpeg motion interpolation to 60 FPS. Export plans now accept 60 FPS.
- Animated production placeholders in the preview and storyboard.
- Qwen3-TTS voice profiles/recording and animation development accumulated since
  the 0.1.0 baseline; these paths retain their experimental/prototype status.
- A synchronized workspace/desktop version command and CI consistency check.

### Changed

- The local video studio targets LTX-2.5 instead of the earlier LTX-2.3 pack.
  A separate Gemma 3 folder is no longer required.
- Decoded frames are trimmed before one H.264 encoding pass, avoiding the
  previous intermediate encode and second compression pass.
- Generation, enhancement and interpolation run sequentially. Interrupted or
  failed jobs keep existing scene media. Finished clips must match their promised
  size, frame rate and frame count before entering the library.
- README, model/setup documentation and roadmap now distinguish current LTX
  capabilities from historical Wan experiments.

### Limitations

- Video is experimental, with manual runtime/model setup. Gated weights require
  publisher approval outside the app; no automatic model/package installation.
- Source inference remains 24 FPS. AI enhancement is not native 1080p generation;
  interpolation is not native 60 FPS generation. Both can introduce artifacts.
- Selected short clips ran on M4 Pro / 24 GiB, with substantial swap. Low-memory
  devices, all ten-second presets and Windows/Linux video inference are unverified.
- Automatic memory planning and inference checkpoint resume are not implemented.
- No signed installer or release publication is created by this version bump.

See [local LTX video](docs/ltx-video.md) for runtime pins and measured evidence.

## 0.1.0 baseline

Initial alpha version used by the repository before synchronized versioning.
Local projects/scenes, model management, generation adapters, production queue,
research tools and development rendering evolved under this version. This entry
records that baseline; it does not assert a historical public release date.
