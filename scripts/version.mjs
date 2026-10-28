import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");
const manifest = JSON.parse(await read("package.json"));
const argument = process.argv[2];
if (process.argv.length !== 3 || !argument) {
  console.error("Usage: node scripts/version.mjs --check | <version>");
  process.exit(1);
}
const check = argument === "--check";
const version = check ? manifest.version : argument;
const numeric = "(?:0|[1-9][0-9]*)";
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`,
);
if (!semver.test(version)) {
  console.error(
    "Use a SemVer version, e.g. 0.2.0-alpha.1 (without a v prefix).",
  );
  process.exit(1);
}

// Compute and validate every edit before writing any file. No Git or network work.
const edits = [];
function plan(path, before, after) {
  if (before !== after) edits.push({ path, after });
}
const manifests = ["package.json"];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(join(root, parent), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const path = `${parent}/${entry.name}/package.json`;
    try {
      await read(path);
      manifests.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
for (const path of manifests) {
  const before = await read(path);
  const data = JSON.parse(before);
  if (typeof data.version !== "string") throw Error(`Missing version: ${path}`);
  if (data.version !== version) {
    data.version = version;
    plan(path, before, JSON.stringify(data, null, 2) + "\n");
  }
}
const configPath = "apps/desktop/src-tauri/tauri.conf.json";
const configBefore = await read(configPath);
const config = JSON.parse(configBefore);
if (config.version !== version) {
  // Preserve unrelated JSON formatting.
  if (!/("version"\s*:\s*")[^"]+("\s*,)/.test(configBefore))
    throw Error(`Cannot find application version: ${configPath}`);
  plan(
    configPath,
    configBefore,
    configBefore.replace(/("version"\s*:\s*")[^"]+("\s*,)/, `$1${version}$2`),
  );
}
for (const [path, pattern] of [
  [
    "apps/desktop/src-tauri/Cargo.toml",
    /(\[package\][\s\S]*?\nversion = ")[^"]+("\n)/,
  ],
  [
    "apps/desktop/src-tauri/Cargo.lock",
    /(\[\[package\]\]\nname = "framebop-studio"\nversion = ")[^"]+("\n)/,
  ],
]) {
  const before = await read(path);
  if (!pattern.test(before))
    throw Error(`Cannot find application version: ${path}`);
  plan(path, before, before.replace(pattern, `$1${version}$2`));
}
const readme = await read("README.md");
const badge = /^\[!\[Version\].*$/m;
if (!badge.test(readme)) throw Error("Cannot find the README version badge.");
plan(
  "README.md",
  readme,
  readme.replace(
    badge,
    `[![Version](https://img.shields.io/badge/version-${version.replaceAll("-", "--")}-f97316)](CHANGELOG.md)`,
  ),
);
if (check) {
  if (edits.length) {
    console.error(
      `Version ${version} is out of sync:\n${edits.map((e) => `  ${e.path}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `Version ${version}: workspace, desktop, Cargo and README agree.`,
  );
} else {
  for (const edit of edits) await writeFile(join(root, edit.path), edit.after);
  console.log(
    `Version ${version}: updated ${edits.length} files. Update CHANGELOG.md before release.`,
  );
}
