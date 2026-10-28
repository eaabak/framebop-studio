# Licensing

Framebop Studio is open source under the **Apache License 2.0** (chosen in
October 2026; see `LICENSE` and `NOTICE`). This document tracks the licences
of what it works with, and the questions still open for a release.

This is an engineering inventory, not legal advice. Licence terms were read in
October 2026 and can change; check the linked sources before relying on them.

## Open questions

These need an answer before a public release.

1. **Which licence for Framebop Studio itself?** Decided: Apache 2.0,
   permissive and with a patent grant, like most of the models it runs.
2. **Remotion is not open source.** Decided for now: Remotion stays the
   renderer and is named as a third-party component under its own licence
   in the README and `NOTICE`; Framebop's own code is Apache 2.0. An
   FFmpeg-only render path remains the way to a fully open pipeline.
   Remotion's licence (read from the `LICENSE.md` of the installed version, 4.0.535) is a custom one:
   free for individuals, non-profits, for-profit organisations with up to 3
   employees, and for evaluation; a paid company licence for anyone else. It
   forbids copying or modifying Remotion "for the purpose of selling, renting,
   licensing, relicensing, or sublicensing" a derivative of it, and says the
   licence will change slightly in Remotion 5.0. Consequences to resolve:
   - Framebop Studio could not honestly be described as fully open source if a
     required component is not.
   - Some users of Framebop Studio would need their own Remotion licence. The
     app would have to say so.
   - Whether bundling Remotion inside a distributed application is permitted
     at all should be confirmed with Remotion.
   - An FFmpeg-only render path would avoid the dependency, at the cost of the
     motion-graphics features Remotion provides. The renderer is already an
     adapter behind the render plan, so a second one can be added without
     changing anything else.
   - **Usage reporting.** Given a licence key, `renderMedia` sends a usage
     event to remotion.pro for every render; given `"free-license"`, it sends
     one too, without the key. Only no key at all sends nothing. Framebop
     passes no key, which is also what keeps rendering free of network
     requests. A company that holds a Remotion licence may be expected to
     report usage; supporting that would have to be an explicit opt-in.
   - Remotion's renderer includes a native compositor with its own FFmpeg
     libraries (`@remotion/compositor-<platform>`). Their licence terms, and
     those of the headless Chrome it drives, must be part of any notice file.
3. **Draw Things' source is GPL-3.0, and the adapters were written by reading
   it.** Framebop Studio's two Draw Things adapters contain no code from
   [draw-things-community](https://github.com/drawthingsai/draw-things-community).
   They were written from facts learned by reading it: route names, JSON key
   conventions and command-line options. One adapter speaks HTTP to the
   running app, the other starts the official tool as a separate program.
   Neither links against or bundles GPL code. Whether that is sufficient
   separation should be confirmed before release. Using the gRPC interface
   directly would be different: it needs code generated from GPL-licensed
   schemas, which is why it has not been done. See
   [draw-things.md](draw-things.md).
4. **Model licences restrict use, and the app must surface them.** Framebop
   Studio does not distribute model weights, but the model manager downloads
   them on the user's behalf from Hugging Face. Before every download it shows
   the licence's name, a one-line summary and a link to the full text, and the
   engine refuses a download that was not explicitly approved. The summaries
   in the catalog are not a substitute for the licence; for example, the LTX-2
   Community License Agreement (January 5, 2026) requires entities with annual
   revenue of US$10 million or more to obtain a separate commercial licence
   from Lightricks, and has further terms. Open: whether approving a download
   should also record that the user accepted the licence, and whether some
   licences need their full text shown in the app.
5. **Redistributing the Node.js binary.** Its licence permits this, but the
   release build must ship the official binary with its licence file and those
   of its bundled dependencies. Not done yet.
6. **Third-party notices.** A release needs a generated notice file covering
   every bundled npm package and Rust crate. Not done yet.

## What ships inside the application today

| Component              | Licence                   | How it is used                          |
| ---------------------- | ------------------------- | --------------------------------------- |
| Tauri and its plugins  | MIT or Apache-2.0         | Compiled into the shell                 |
| Node.js runtime        | MIT, plus bundled deps    | Bundled binary that runs the engine     |
| React                  | MIT                       | Bundled in the interface                |
| Zustand                | MIT                       | Bundled in the interface                |
| Zod                    | MIT                       | Bundled in the interface and the engine |
| i18next, react-i18next | MIT                       | Bundled in the interface                |
| Tailwind CSS           | MIT                       | Build tool; generated CSS is bundled    |
| Lucide icons           | ISC                       | Bundled in the interface                |
| Inter typeface         | SIL Open Font License 1.1 | Font files bundled in the interface     |
| SQLite, via Node.js    | Public domain             | Part of the Node.js runtime             |

Licences in this table are as commonly published for these projects. They have
not been audited package by package, including transitive dependencies. Doing
that is part of item 6.

## Used in development, not yet bundled

These run in the development build. The installed app does not contain them
yet; packaging them is a release task (see the roadmap).

| Component                 | Licence                    | How it is used                                                                                         |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Remotion 4.0.535          | Remotion License (custom)  | `remotion`, `@remotion/renderer` and `@remotion/bundler`: the composition and the render worker.       |
| Remotion compositor       | Remotion License, + FFmpeg | Native binary with FFmpeg libraries, installed with `@remotion/renderer`. Build options not yet known. |
| Chrome headless shell     | BSD-3-Clause and others    | Chosen by the user; never downloaded by Framebop. Chromium carries many third-party notices.           |
| webpack (via the bundler) | MIT                        | Build time only, to bundle the composition.                                                            |
| PixiJS 8.22               | MIT                        | Draws animations that use pictures (WebGL), in the composition and in the editor's animation preview.  |
| Test art (`test-art/`)    | Made for this project      | Temporary pictures, drawn in SVG for Framebop to test sprites. Not production art.                     |

## Used if present, never bundled

| Component                  | Licence                                                         | Notes                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FFmpeg                     | LGPL-2.1+ or GPL, depending on the build                        | The user's own installation is run as a separate program. Bundling it later would bring its licence obligations with it, which depend on how that build was configured.                                              |
| Draw Things                | Proprietary app; community code is GPL-3.0                      | Only detected. Never bundled, modified or redistributed.                                                                                                                                                             |
| llama.cpp (`llama-server`) | MIT                                                             | The user's or a development copy of an official build, run as a separate program for language models. Not bundled yet (Phase 6).                                                                                     |
| Python and `kokoro`        | Python: PSF; `kokoro`, `misaki`: Apache-2.0; PyTorch: BSD-style | The user's own interpreter, run as a separate program for narration. Its English G2P can fall back to espeak-ng (GPL-3.0) through `espeakng_loader` and `phonemizer` (GPL-3.0+). Nothing of it is bundled or linked. |

## Downloaded on request, never bundled

| Component                         | Licence                                 | Notes                                                                                     |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Kokoro 82M (both catalog entries) | Apache-2.0, per the repository metadata | Downloaded only when the user approves.                                                   |
| LTX-2.5 distilled MLX Q4          | LTX-2.x Community License Agreement     | Gated weights obtained separately with publisher approval; see [LTX setup](ltx-video.md). |
| Qwen2.5 1.5B Instruct (Q4_K_M)    | Apache-2.0                              | Downloaded only when the user approves.                                                   |

Hugging Face is used without an account: the engine calls its public REST
endpoints for a repository's file list and for the files themselves. No access
token is sent or stored, so gated models cannot be downloaded.

Repositories added from Hugging Face's search carry the licence their
publisher declared in the repository metadata, shown as declared, often only
as an id such as `other`. Framebop has not reviewed those licences; the user
is pointed to the repository page to read them before downloading.

## Services used with the user's own credentials

| Service             | Terms                                             | Notes                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube Data API v3 | YouTube API Services Terms and Developer Policies | Each user brings their own API key and accepts Google's terms for it. Stored API data is marked for refresh after 30 days, as the policies require. Comments are other people's words: they are quoted as evidence, never republished. |

Transcripts are imported only with the user's statement of why they may use
them. Whether a given use of a third party's transcript is permitted is the
user's responsibility; Framebop records the statement but cannot verify it.

## Planned

| Component    | Licence | Concern                                                                                             |
| ------------ | ------- | --------------------------------------------------------------------------------------------------- |
| ONNX Runtime | MIT     | Planned runtime for Kokoro. Its bundled dependencies' licences must be checked too.                 |
| ComfyUI      | GPL-3.0 | To be driven as a separate program over its API, not linked or bundled. Confirm that is sufficient. |

## Optional local video finishing

The LTX MLX runtime and model pack are user-managed; their licenses remain
separate from Framebop. The pack includes its Gemma 4 text tower; the adapter
uses the pack's declared configuration rather than substituting another encoder.

Optional enhancement calls the separately installed
[Real-ESRGAN MLX runtime](https://github.com/xocialize/realesrgan-mlx) and
[animevideov3 MLX weights](https://huggingface.co/mlx-community/Real-ESRGAN-animevideov3),
whose publishers declare BSD-3-Clause terms. Neither the runtime nor those
weights are redistributed in this repository. FFmpeg's motion interpolation
uses the user's FFmpeg installation and its existing license obligations.
See [the pinned setup](ltx-video.md#optional-1080p--60-fps-finishing).
