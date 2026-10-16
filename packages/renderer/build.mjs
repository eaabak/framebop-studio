// Builds the two artefacts the engine needs to render, both into dist/:
//
//   render-worker.mjs  the worker process, bundled with esbuild. Remotion's
//                      renderer stays an external dependency: it locates its
//                      native compositor binary at run time.
//   site/              the composition, bundled once with Remotion's bundler,
//                      so rendering never needs webpack or the source files.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await build({
  entryPoints: [here("./src/worker.ts")],
  outfile: here("./dist/render-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "inline",
  external: ["@remotion/renderer"],
  logLevel: "info",
});

const site = here("./dist/site");
await rm(site, { recursive: true, force: true });
await bundle({
  entryPoint: here("./src/composition/index.ts"),
  outDir: site,
  rootDir: here("."),
  enableCaching: false,
});
console.log(`Composition bundled into ${site}`);
