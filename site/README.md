# framebop.com

The website of Framebop Studio: plain HTML, CSS and JavaScript, with no
build step, no dependencies, no trackers and no cookies.

| File                                   | What it is                                                      |
| -------------------------------------- | --------------------------------------------------------------- |
| `index.html`                           | The home page, with its English text                            |
| `videos.html`                          | The video gallery, served as `/videos`                          |
| `styles.css`                           | Colours from the Framebop icon, light and dark, mobile first    |
| `icons.svg`                            | The icons both pages use (`<use href="icons.svg#id">`)          |
| `i18n.js`                              | Translations (Turkish today); English stays in the pages        |
| `showcase.js`                          | The list of videos made with Framebop                           |
| `gallery.js`                           | Video cards, search, filters and the video dialog               |
| `player.js`                            | The Apple-style video player: glass controls, keys, full screen |
| `main.js`                              | Repository links, the language switch, the reveal on scroll     |
| `vercel.json`                          | Security headers, caching, and `/tr` for the Turkish home page  |
| `favicon.svg`, `favicon-32.png`        | The app icon (`apps/desktop/public/brand/framebop-icon.svg`)    |
| `apple-touch-icon.png`, `og-image.jpg` | The icon on cream, and the link preview image (1200 × 630)      |

The repository links point to `eaabak/framebop-studio`: `REPO_URL` in
`main.js`, and the plain hrefs in the pages for visitors without
JavaScript.

## Preview

```bash
npx serve site
```

`serve` handles clean URLs, so `/videos` works as on Vercel. With
`python3 -m http.server 8080 --directory site` instead, open
`/videos.html`. Add `?lang=tr` for Turkish; `/tr` works only on Vercel,
through the rewrite in `vercel.json`.

## Deploy on Vercel

Import the repository in Vercel and set **Root Directory** to `site`, with
the framework preset **Other** and no build command. Every push to `main`
then publishes the site.

## Adding a video

Put the MP4 and its poster in `site/videos/` and add an entry to
`showcase.js`; the comment at its top shows the fields (title, maker,
topics, narration language, models used and more). The video then appears
on `/videos`, where visitors can search and filter, and, if it is among the
first three, on the home page. While the list is empty, both show an
invitation instead.

Videos are served from this site, never embedded from another one, so the
pages stay free of trackers. Sharing videos from the site itself (uploads,
accounts) needs a server and is not built yet.

## Adding a language

Copy the `tr` block in `i18n.js` under the new language code, translate the
values, and add a button with `data-lang="<code>"` to the language switch in
both pages. A key that is missing falls back to English.
