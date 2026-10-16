// Bundles the engine into a single ES module so the desktop shell can ship it
// as one resource file next to a Node.js runtime, with no node_modules.
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const manifest = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

await build({
  entryPoints: [new URL("./src/main.ts", import.meta.url).pathname],
  outfile: new URL("./dist/worker.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Inline maps keep the bundle a single file while still giving readable
  // stack traces in user-submitted logs (Node runs with --enable-source-maps).
  sourcemap: "inline",
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  logLevel: "info",
});
