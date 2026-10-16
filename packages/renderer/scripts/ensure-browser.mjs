/**
 * Puts Remotion's Chrome Headless Shell next to the renderer, once, so that
 * Framebop draws videos with its own browser and nobody has to choose one.
 * Does nothing when it is already there.
 */
import { ensureBrowser } from "@remotion/renderer";

const status = await ensureBrowser({
  logLevel: "error",
  onBrowserDownload: () => {
    console.log("Downloading the renderer's browser (Chrome Headless Shell)…");
    return { version: null, onProgress: () => {} };
  },
});
console.log(`Renderer browser: ${status.path}`);
