# Framebop Studio promo

A short promo video made with [Remotion](https://www.remotion.dev) from
recordings of the real app. The voice-over is Framebop's own narration
(**Read with AI**), and the closing example is a video Framebop rendered.

Remotion is not open source; see its [licence](https://www.remotion.dev/docs/license)
and [docs/licensing.md](../../docs/licensing.md).

| Path                | What it is                                                    |
| ------------------- | ------------------------------------------------------------- |
| `src/Promo.tsx`     | The segments: logo, promise, the app, the result, the closing |
| `src/timeline.ts`   | Durations, cuts of the recordings, camera moves, voice-over   |
| `src/parts.tsx`     | Window frame, camera, step chips, captions, pills             |
| `src/Logo.tsx`      | The icon, from the desktop app's artwork, with blinking eyes  |
| `src/Instagram.tsx` | The Instagram carousel, from screenshots of the app           |
| `scripts/`          | Record the app (`record.mjs`) and make the voice-over         |
| `public/`           | Recordings, voice-over and the example video; not in Git      |
| `out/`              | Rendered videos; not in Git                                   |

## Make it

1. **A demo library.** Never record in your real library. Clone it, so the
   models and engines are there without downloading or copying:

   ```bash
   cp -cR ~/Library/Application\ Support/com.framebop.studio /tmp/framebop-demo
   ```

   The clone keeps absolute paths to the real library in `framebop.db`
   (`model_installations.storage_root` and `directory`); point them at the
   clone before using it. Delete its projects in the app so the recording
   starts empty.

2. **The interface** on that library, in a browser:

   ```bash
   FRAMEBOP_UI_PORT=1431 FRAMEBOP_BRIDGE_PORT=4331 FRAMEBOP_DATA_DIR=/tmp/framebop-demo pnpm dev:web
   ```

3. **Record** with Google Chrome (headless) and FFmpeg:

   ```bash
   pnpm --filter @framebop/promo record
   ```

   Each step becomes `public/rec/NN-step.mp4`. Copy the newest video from
   the demo library's `exports/` to `public/demo/lighthouse.mp4`.

4. **Voice-over:** the lines are in `scripts/lines.mjs`, read by Bella from
   Framebop's English voice pack.
   `pnpm --filter @framebop/promo voice-pack` reads them with the voice
   runtime the app installed and writes `public/vo/vo-01.wav` … `vo-09.wav`
   (name another voice, such as `am_adam`, after the command; set
   `FRAMEBOP_DATA_DIR` for a library other than the default).

   To make them in the app instead, `pnpm --filter @framebop/promo voice`
   makes a project named "Promo voice" with one scene per line and reads
   each one with **Read with AI**, which uses the pack's first voice (Nova).
   Copy the scenes' audio (`scenes.audio_asset_id` →
   `assets.relative_path`, under the library's `media/`) in order to
   `public/vo/`.

5. **Render:** `pnpm --filter @framebop/promo render` writes
   `out/framebop-promo.mp4`. If the recordings change, update the cut points
   and camera moves in `src/timeline.ts`.

   Name a composition to render another version: `PromoMusic` adds the
   music, and `PromoVertical` and `PromoVerticalMusic` are 1080×1920 for
   Instagram Reels and TikTok (`render PromoVertical` writes
   `out/framebop-promo-vertical.mp4`). The tall versions use the same
   timeline, with the camera moves from `STAGE_SHOTS_TALL`.

**Instagram carousel:** `pnpm --filter @framebop/promo instagram` saves
eight real screenshots of the app (frames of the recordings, listed in
`scripts/instagram.mjs`) to `public/shots` and renders the five 1080×1350
slides of `src/Instagram.tsx` to `out/instagram/slide-1.png` … `slide-5.png`,
with the screenshots themselves in `out/instagram/screenshots`, and a
1080×1920 story that points to the post (`out/instagram/story.png`).

For social media, normalise the loudness afterwards:

```bash
ffmpeg -i out/framebop-promo.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 192k out/framebop-promo-voice.mp4
```
