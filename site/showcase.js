/*
 * Videos made with Framebop Studio. gallery.js shows them on /videos (with
 * search, topics, narration language and sorting) and the first three on
 * the home page. While this list is empty, both show an invitation instead.
 *
 * To add a video:
 * 1. Put an H.264 MP4 and a poster image (JPEG, 16:9 looks best) in
 *    site/videos/. Keep the MP4 small (720p, a few MB): it is served from
 *    this site and stored in the repository.
 * 2. Add an entry below. Only `src` and `title` are required; `id` makes a
 *    stable link (framebop.com/videos#v=<id>).
 * 3. Show only videos you have the right to publish: check the licences of
 *    the models, voices and music used, and ask the maker first.
 *
 * Example:
 *
 *   {
 *     id: "lighthouse-keeper",
 *     src: "videos/lighthouse-keeper.mp4",
 *     poster: "videos/lighthouse-keeper.jpg",
 *     title: { en: "The lighthouse keeper", tr: "Deniz feneri bekçisi" },
 *     description: { en: "A bedtime story in four scenes.", tr: "..." },
 *     duration: "1:12",
 *     date: "2026-11-02",
 *     language: "en", // the narration's language, as a language code
 *     captions: "videos/lighthouse-keeper.en.vtt", // optional WebVTT file
 *     tags: ["story", "kids"], // topic names are in i18n.js ("tag.story")
 *     madeWith: ["Stable Diffusion 1.5", "Kokoro", "Qwen3 4B"],
 *     by: "Ada", // optional credit
 *     byUrl: "https://github.com/ada", // optional link for the credit
 *     featured: true, // shown first
 *   },
 */
window.FRAMEBOP_SHOWCASE = [];
