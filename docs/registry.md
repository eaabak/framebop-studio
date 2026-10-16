# The Framebop model registry

The registry is the list of models Framebop Studio offers in **AI Models →
Discover → Framebop Verified**. It is a versioned JSON file, validated with
Zod (`RegistryManifestSchema` in `packages/core/src/models.ts`) before any
of it is used.

- A copy ships with the app: `packages/model-manager/registry/framebop-registry.json`.
- A newer copy can be fetched from an address set in **Settings → Model
  registry address**, only when the user chooses **Check for registry
  updates**. Nothing is fetched at startup. The address must be `https`
  (plain `http` is accepted only on this computer's loopback interface, for
  testing), may not contain credentials, and the file may be at most 2 MB.
- A fetched registry is used only while it is newer than the one in the app,
  so updating the app never leaves an older registry in charge. It is kept in
  the library's database and works offline. A registry that fails validation
  changes nothing: the one in use stays, and the reason is shown.

A hosted registry has not been published yet. The intended home is a
repository of its own, so that new models reach users without a release.

## What needs an app update and what does not

A new **variant of a model that an existing engine already runs** (another
quantization, a newer commit, more voices) needs only a registry update.
A model that needs a **new engine or runtime** needs a new version of the app,
because the registry cannot add code.

## Format, version 1

```jsonc
{
  "schemaVersion": 1, // this build reads format 1 only
  "registryVersion": "2026.10.14", // date-based, optionally ".n"; sorts as text
  "publishedAt": "2026-10-14",
  "models": [/* catalog entries */],
}
```

Each entry (`CatalogEntrySchema`):

| Field                                                                  | Meaning                                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                   | Stable id, never reused for a different model.                                                                               |
| `name`, `description`, `provider`, `family`, `variant`, `quantization` | What the model is, in words.                                                                                                 |
| `group`                                                                | Entries that are variants of one model share a group; the details page lists them together.                                  |
| `categories`                                                           | What it generates: `text-to-image`, `image-to-image`, `text-to-video`, `image-to-video`, `text-to-speech`, `audio`, `other`. |
| `source`, `repoId`, `revision`                                         | Where the files come from: a Hugging Face repository at a full 40-character commit.                                          |
| `format`, `files`                                                      | Only the files this variant needs, each with its size and a hash: `sha256` for files in Git LFS, `gitBlobId` for small ones. |
| `runtime`                                                              | The runtime id an engine recognises (for example `kokoro-pytorch`), and its name.                                            |
| `hardware`                                                             | Accelerators and minimum memory, only where the publisher states them; `null` otherwise.                                     |
| `platforms`                                                            | Operating systems the runtime supports, or `null` when not stated.                                                           |
| `license`                                                              | Id, name, link and a one-line summary. Never more permissive than the source.                                                |
| `access`                                                               | Whether the repository is gated, and what that requires.                                                                     |
| `presets`                                                              | Settings for one engine and one task; see below.                                                                             |
| `inferenceTests`                                                       | Runs on real hardware that actually happened: date, OS, architecture, hardware, engine, result, detail.                      |
| `pageUrl`, `verifiedOn`                                                | The repository page, and when the metadata was last read from the Hub.                                                       |

## Adding a model

1. Pin a commit. Read `GET https://huggingface.co/api/models/{repo}/revision/{commit}?blobs=true`.
2. List only the files the variant needs. Copy each size, and `lfs.sha256` or
   `blobId`, exactly.
3. Read the licence in the repository itself. Summarise it without making it
   sound more permissive than it is. Open weights are not necessarily open
   source, and many licences restrict commercial use.
4. Set `runtime.id` to one an engine in the app recognises. If none does, the
   model can still be listed, and the gallery calls it unsupported.
5. State hardware requirements only when the publisher does.
6. Add `inferenceTests` only for runs that really happened, and presets only
   with settings the engine offers. Mark a preset `verified` only when its
   results were actually checked.
7. Raise `registryVersion`.

## Presets

```jsonc
{
  "id": "natural-pace",
  "kind": "balanced", // fast-preview | balanced | quality | custom
  "label": "Natural pace",
  "description": "Kokoro's own speed.",
  "adapterId": "kokoro", // the engine it was written for
  "task": "audio_generation",
  "parameters": { "voice": "af_heart", "speed": 1 },
  "size": null, // output size, only for engines that take one
  "verified": true,
  "note": "Used for the narration checked during development.",
}
```

A preset is offered only for its engine and task. When it is applied, each
setting is checked against what the engine accepts; anything it cannot take
is reported in the Generate section, never dropped silently. There are no
universal defaults: a model without presets uses the engine's own.
