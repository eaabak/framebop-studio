# Contributing to Framebop Studio

Thank you for helping. Framebop Studio is in early development, so expect
things to change; issues that describe a real use are as valuable as code.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), like the rest of the project.

## Setting up

You need Node.js 22.13 or later and pnpm (the version is pinned in
`package.json`). The desktop app also needs Rust and the Tauri prerequisites;
the browser build does not.

```bash
pnpm install
pnpm dev:web   # the interface in a browser, with the engine behind it
pnpm dev       # the desktop app (Tauri)
```

`FRAMEBOP_DATA_DIR` points a development run at its own library, so you never
touch your real one.

## Before you open a pull request

Run the same checks as CI:

```bash
pnpm typecheck
pnpm format:check
pnpm test
pnpm build
```

The repository has no automated tests at the moment; `pnpm test` passes when
there are none. New tests are welcome: use stand-ins for models and programs
so they need no network and no GPU.

## Where things are

- `apps/desktop`: the interface (React) and the Tauri shell.
- `packages/orchestrator`: the engine: jobs, models, runtimes, rendering.
- `packages/ai-adapters`: one adapter per backend (stable-diffusion.cpp,
  sherpa-onnx, Draw Things, Remotion, ...).
- `packages/model-manager`: the model catalog, downloads and hash checks.
- `packages/core`: shared types and the engine's RPC contract.
- `docs/`: architecture, roadmap, models, licensing.

## Principles

- **Local first.** Nothing leaves the computer without the user's consent;
  there is no telemetry.
- **Pinned and verified.** Every runtime and model is pinned to an exact
  version and SHA-256, and downloaded only after the user agrees.
- **Honest interface.** Say what works and what does not; never claim a
  result that was not checked.
- **English** for code, comments and documentation; the interface is
  translated into English, Turkish, German, Spanish and Brazilian
  Portuguese (`apps/desktop/src/i18n/locales`).

## Adding a model to the catalog

Catalog entries live in
`packages/model-manager/registry/framebop-registry.json`. Each one pins a
Hugging Face repository to a commit and lists every file with its size and
SHA-256 (from the Hugging Face API). A model published as separate files
lists its `parts`: which file is the diffusion model, the VAE or a text
encoder, or which other catalog model provides a part. Only add models whose
licence allows it, and state the licence accurately.

Users can also add models from Hugging Face themselves, without a catalog
entry, by choosing the parts in the **Models** tab.
