// Entry point of the Remotion bundle. Bundled at build time into dist/site,
// which the render worker opens in a headless browser.
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
