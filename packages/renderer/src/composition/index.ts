// Entry point of the Remotion bundle. Bundled at build time into dist/site,
// which the render worker opens in a headless browser.
// The Lab's motion graphics are set in Inter, as the app is.
import "@fontsource-variable/inter";
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
