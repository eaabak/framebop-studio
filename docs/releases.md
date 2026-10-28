# Versioning and releases

Framebop Studio uses SemVer and remains pre-1.0. The next prepared version is
`0.2.0-alpha.1`; it is a development preview, not a published installer release.
The root `package.json` is the source of truth. Workspace packages, the desktop
Tauri configuration, the Rust application crate/lockfile and the README badge
share that version. Model registry versions, database schema numbers and pinned
third-party runtime/model revisions are independent and must not be bumped just
because the application version changes.

## Version policy

- `0.MINOR.0`: a substantial set of features or pre-1.0 compatibility changes.
- `0.MINOR.PATCH`: fixes within that feature line.
- `-alpha.N`: an early preview; increment `N` for the next preview.
- Git release tags use `v`, for example `v0.2.0-alpha.1`; package/config versions
  omit `v`. A prerelease does not promise a stable public API or hardware fit.

All current packages are private workspace packages. Synchronized versions do
not publish them to npm or crates.io, and existing user libraries keep the same
application identifier and data directory.

## Check or change a version

```bash
node scripts/version.mjs --check
node scripts/version.mjs 0.2.0-alpha.2
node scripts/version.mjs --check
```

The equivalent workspace aliases are `pnpm version:check` and
`pnpm version:set <version>`. After a version bump, pnpm may request a workspace
installation metadata refresh before running scripts; the direct Node commands
need no installed dependencies and avoid that package-manager step.

The setter changes only version fields and the README badge. It validates the
input and plans all changes before writing; it does not install packages, change
model pins, commit, create tags, push or publish. Running it again with the same
version makes no changes. CI rejects inconsistent application versions.

After a bump, update [CHANGELOG.md](../CHANGELOG.md) with actual user-facing
behavior, setup changes, compatibility effects and known limits. Keep an entry
under **Unreleased** until maintainers intentionally publish it. Do not describe
an existing-clip finishing test as a fresh full model-generation benchmark.

## Maintainer release checklist

1. Review the complete diff and third-party notices. Keep model weights, virtual
   environments, private paths, credentials and benchmark media out of Git.
2. Run `pnpm version:check`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`,
   `python3 packages/ai-adapters/tests/test_ltx_encoding.py` and `pnpm build`.
3. Document which operating systems and hardware were actually tested. Any real
   inference or signed installer checks are separate, explicitly scoped work.
4. When publication is authorized, replace the Unreleased heading with the
   version and release date, and commit the reviewed release preparation.
5. Create an annotated `v<version>` tag on that reviewed commit, push it, and
   publish release notes matching the changelog. Mark alpha builds as prereleases.
6. Attach only installers/artifacts that were actually built and checked, with
   their checksums and signing status. Never imply a source tag is an installer.

There is currently no automatic tag-triggered packaging, signing, notarization
or GitHub Release publication. Adding those pipelines is separate distribution
work; the version consistency check does not claim to validate a Rust installer.
