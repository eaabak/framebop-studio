import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Exercise the CLI in a disposable workspace, never the real manifests.
test("version CLI synchronizes application versions and detects drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "framebop-version-"));
  try {
    for (const path of ["scripts", "apps/desktop/src-tauri", "packages/core"])
      await mkdir(join(root, path), { recursive: true });
    await copyFile(
      new URL("./version.mjs", import.meta.url),
      join(root, "scripts/version.mjs"),
    );
    const json = (path, data) =>
      writeFile(join(root, path), JSON.stringify(data, null, 2) + "\n");
    await json("package.json", { version: "0.1.0", private: true });
    await json("apps/desktop/package.json", {
      version: "0.1.0",
      dependencies: { external: "1.2.3" },
    });
    await json("packages/core/package.json", { version: "0.1.0" });
    await json("apps/desktop/src-tauri/tauri.conf.json", {
      version: "0.1.0",
      identifier: "com.framebop.studio",
    });
    await writeFile(
      join(root, "apps/desktop/src-tauri/Cargo.toml"),
      '[package]\nname = "framebop-studio"\nversion = "0.1.0"\n',
    );
    await writeFile(
      join(root, "apps/desktop/src-tauri/Cargo.lock"),
      '[[package]]\nname = "framebop-studio"\nversion = "0.1.0"\n\n[[package]]\nname = "external"\nversion = "0.1.0"\n',
    );
    await writeFile(
      join(root, "README.md"),
      "[![Version](https://example.test/old)](CHANGELOG.md)\n",
    );
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [join(root, "scripts/version.mjs"), ...args],
        { encoding: "utf8" },
      );
    assert.equal(run("0.2.0-alpha.1").status, 0);
    assert.equal(run("--check").status, 0);
    assert.match(run("0.2.0-alpha.1").stdout, /updated 0 files/);
    const desktop = JSON.parse(
      await readFile(join(root, "apps/desktop/package.json"), "utf8"),
    );
    assert.equal(desktop.version, "0.2.0-alpha.1");
    assert.equal(desktop.dependencies.external, "1.2.3");
    assert.match(
      await readFile(join(root, "apps/desktop/src-tauri/Cargo.lock"), "utf8"),
      /name = "external"\nversion = "0.1.0"/,
    );
    for (const invalid of ["v0.2.0", "0.2", "0.2.0-alpha.01", "01.2.0"])
      assert.equal(run(invalid).status, 1);
    await json("packages/core/package.json", { version: "0.1.0" });
    assert.equal(run("--check").status, 1);
    assert.equal(run("0.2.0-alpha.1").status, 0);
    assert.equal(run("--check").status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
