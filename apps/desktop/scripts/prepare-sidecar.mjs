// Places a Node.js runtime where Tauri expects a "sidecar" binary.
//
// The engine is JavaScript, and end users must not need Node.js installed, so
// the desktop app ships its own copy of the runtime and starts the engine with
// it. Tauri requires such bundled executables to be named
// `<name>-<rust target triple>` under src-tauri/binaries; this script copies
// the Node.js binary that is running it to that name.
//
// For local development and local builds that is all that is needed. A public
// release should instead download the official Node.js build for each target
// and verify its checksum; see docs/architecture.md.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIDECAR_NAME = "framebop-node";
// node:sqlite, which the engine depends on, is usable without a flag from 22.13.
const MINIMUM_NODE = [22, 13];

const [major, minor] = process.versions.node.split(".").map(Number);
if (
  major < MINIMUM_NODE[0] ||
  (major === MINIMUM_NODE[0] && minor < MINIMUM_NODE[1])
) {
  console.error(
    `Framebop Studio needs Node.js ${MINIMUM_NODE.join(".")} or newer to build; this is ${process.versions.node}.`,
  );
  process.exit(1);
}

function hostTriple() {
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // Older toolchains lack --print host-tuple.
    const verbose = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
    const host = /^host:\s*(\S+)$/m.exec(verbose)?.[1];
    if (!host)
      throw new Error(
        "Could not determine the Rust host target. Is Rust installed?",
      );
    return host;
  }
}

const triple = process.env.FRAMEBOP_TARGET_TRIPLE ?? hostTriple();
const extension = triple.includes("windows") ? ".exe" : "";
const binaries = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/binaries",
);
const destination = join(binaries, `${SIDECAR_NAME}-${triple}${extension}`);
const stampPath = `${destination}.json`;
const source = realpathSync(process.execPath);

// Copying ~100 MB on every run would slow down `pnpm dev`, so skip it when
// the same runtime is already in place.
const stamp = { source, version: process.version, size: statSync(source).size };
if (existsSync(destination) && existsSync(stampPath)) {
  if (readFileSync(stampPath, "utf8") === JSON.stringify(stamp))
    process.exit(0);
}

mkdirSync(binaries, { recursive: true });
copyFileSync(source, destination);
chmodSync(destination, 0o755);
writeFileSync(stampPath, JSON.stringify(stamp));
console.log(`Bundled Node.js ${process.version} as ${destination}`);

// A runtime that links against libraries outside the operating system only
// works on machines that have those libraries, which is not acceptable for a
// distributable app. Package-manager builds of Node.js are often like this.
if (process.platform === "darwin") {
  const linked = execFileSync("otool", ["-L", destination], {
    encoding: "utf8",
  })
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(
      (library) =>
        library &&
        !library.startsWith("/usr/lib/") &&
        !library.startsWith("/System/"),
    );
  if (linked.length > 0) {
    console.warn(
      `Warning: this Node.js links against non-system libraries and will not run on other Macs:\n  ${linked.join("\n  ")}\nUse an official Node.js build for anything you intend to distribute.`,
    );
  }
}
