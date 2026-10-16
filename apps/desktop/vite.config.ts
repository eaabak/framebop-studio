import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Both are set by scripts/dev-web.mjs, and only when the interface is being
// developed in a browser against the engine's development bridge. In the
// desktop app neither exists and the interface talks to the engine over IPC.
const bridgeUrl = process.env.FRAMEBOP_BRIDGE_URL;
const bridgeToken = process.env.FRAMEBOP_BRIDGE_TOKEN;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Rust compiler output visible when running under `tauri dev`.
  clearScreen: false,
  define: {
    __DEV_BRIDGE__: JSON.stringify(Boolean(bridgeUrl)),
  },
  server: {
    // 1420 is what the desktop shell loads. `pnpm dev:web` may use another
    // port so that it can run next to an open desktop app.
    port: Number(process.env.FRAMEBOP_UI_PORT ?? 1420),
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: bridgeUrl
      ? {
          // The proxy adds the bridge token server-side, so the secret never
          // reaches code running in the browser.
          "/__engine": {
            target: bridgeUrl,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/__engine/, ""),
            headers: { authorization: `Bearer ${bridgeToken}` },
          },
        }
      : undefined,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
