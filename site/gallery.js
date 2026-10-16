/*
 * The video gallery: cards built from showcase.js, a detail dialog with the
 * player from player.js, and, on /videos, search, topic and language filters
 * and sorting. The home page shows the first few videos the same way.
 *
 * Markup that gallery.js adds at load (the dialog) carries data-i18n, so
 * main.js translates it with the rest of the page. Cards are rebuilt on the
 * "framebop:language" event, with text from i18n.js through t() below.
 */
(() => {
  "use strict";

  const VIDEOS_PATH = "/videos";
  const PAGE_SIZE = 24;
  const HOME_COUNT = 3;
  const ICONS = "icons.svg";

  const items = (
    Array.isArray(window.FRAMEBOP_SHOWCASE) ? window.FRAMEBOP_SHOWCASE : []
  )
    .filter((item) => item && item.src)
    .map((item, index) => ({
      ...item,
      id: String(item.id || `video-${index + 1}`),
      order: index,
      time: Date.parse(item.date || "") || 0,
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      madeWith: Array.isArray(item.madeWith) ? item.madeWith.map(String) : [],
    }));
  const byId = new Map(items.map((item) => [item.id, item]));

  // ---------- Text ----------

  const lang = () => document.documentElement.lang || "en";

  function t(key, fallback) {
    const dict = (window.FRAMEBOP_I18N || {})[lang()];
    return dict && typeof dict[key] === "string" ? dict[key] : fallback;
  }

  function localized(value) {
    if (value && typeof value === "object") {
      return value[lang()] || value.en || "";
    }
    return value ? String(value) : "";
  }

  function languageName(code) {
    try {
      const name = new Intl.DisplayNames([lang()], { type: "language" }).of(
        code,
      );
      return name.charAt(0).toLocaleUpperCase(lang()) + name.slice(1);
    } catch {
      return code;
    }
  }

  function tagName(tag) {
    return t(`tag.${tag}`, tag.charAt(0).toUpperCase() + tag.slice(1));
  }

  function formatDate(item) {
    if (!item.time) return "";
    try {
      return new Intl.DateTimeFormat(lang(), { dateStyle: "medium" }).format(
        item.time,
      );
    } catch {
      return item.date;
    }
  }

  function countText(n) {
    let rule = "other";
    try {
      rule = new Intl.PluralRules(lang()).select(n) === "one" ? "one" : "other";
    } catch {
      // Older browsers: "other" reads fine.
    }
    const fallback = rule === "one" ? "{n} video" : "{n} videos";
    return t(`gallery.count.${rule}`, fallback).replace("{n}", String(n));
  }

  // Case- and accent-insensitive search, Turkish dotless i included.
  function fold(text) {
    return String(text)
      .toLocaleLowerCase()
      .replace(/ı/g, "i")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  function searchText(item) {
    const titles =
      item.title && typeof item.title === "object"
        ? Object.values(item.title)
        : [item.title];
    const descriptions =
      item.description && typeof item.description === "object"
        ? Object.values(item.description)
        : [item.description];
    return fold(
      [
        ...titles,
        ...descriptions,
        item.by,
        ...item.tags,
        ...item.tags.map(tagName),
        ...item.madeWith,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  // Featured first, then newest; the list order breaks ties.
  function byFeatured(a, b) {
    return (
      Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
      b.time - a.time ||
      a.order - b.order
    );
  }

  function byNewest(a, b) {
    return b.time - a.time || a.order - b.order;
  }

  // ---------- Elements ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function icon(name, className = "icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `${ICONS}#${name}`);
    svg.append(use);
    return svg;
  }

  function maker(item) {
    const wrap = el("span", "v-maker");
    const avatar = el("span", "v-avatar", item.by.trim().charAt(0));
    avatar.setAttribute("aria-hidden", "true");
    wrap.append(avatar);
    if (item.byUrl) {
      const link = el("a", "", item.by);
      link.href = item.byUrl;
      link.rel = "noopener nofollow ugc";
      wrap.append(link);
    } else {
      wrap.append(el("span", "", item.by));
    }
    return wrap;
  }

  function card(item, href) {
    const li = el("li", "v-card");
    const thumb = el("div", "v-thumb");
    if (item.poster) {
      const img = el("img");
      img.src = item.poster;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 640;
      img.height = 360;
      thumb.append(img);
    }
    const play = el("span", "glass-play");
    play.append(icon("i-play"));
    thumb.append(play);
    if (item.duration) thumb.append(el("span", "v-duration", item.duration));
    if (item.featured) {
      thumb.append(el("span", "v-badge", t("gallery.featured", "Featured")));
    }

    const body = el("div", "v-body");
    const title = el("h3", "v-title");
    const link = el("a", "v-link", localized(item.title));
    link.href = `${href}#v=${encodeURIComponent(item.id)}`;
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) {
        return;
      }
      event.preventDefault();
      openVideo(item, true);
    });
    title.append(link);
    body.append(title);

    const meta = el("p", "v-meta");
    if (item.by) meta.append(maker(item));
    if (item.language) meta.append(el("span", "", languageName(item.language)));
    body.append(meta);

    if (item.tags.length) {
      const tags = el("p", "v-tags");
      for (const tag of item.tags) tags.append(el("span", "tag", tagName(tag)));
      body.append(tags);
    }
    li.append(thumb, body);
    return li;
  }

  // ---------- Dialog ----------

  let dialog = null;
  let player = null;
  let current = null;

  const PLAYER_HTML = `
    <div class="player" data-player>
      <video playsinline preload="metadata"></video>
      <button type="button" class="player-big" data-player-big aria-label="Play" data-i18n-attr="aria-label:player.play">
        <svg class="icon" aria-hidden="true"><use href="${ICONS}#i-play" /></svg>
      </button>
      <div class="player-bar" data-player-bar>
        <button type="button" class="player-button" data-player-toggle aria-pressed="false" aria-label="Play" data-i18n-attr="aria-label:player.play">
          <svg class="icon icon-play" aria-hidden="true"><use href="${ICONS}#i-play" /></svg>
          <svg class="icon icon-pause" aria-hidden="true"><use href="${ICONS}#i-pause" /></svg>
        </button>
        <span class="player-time" data-player-elapsed aria-hidden="true">0:00</span>
        <input class="player-seek" data-player-seek type="range" min="0" max="0" step="0.1" value="0" aria-label="Position" data-i18n-attr="aria-label:player.seek" />
        <span class="player-time" data-player-remaining aria-hidden="true"></span>
        <button type="button" class="player-button" data-player-captions aria-pressed="false" aria-label="Captions" data-i18n-attr="aria-label:player.captions" hidden>
          <svg class="icon" aria-hidden="true"><use href="${ICONS}#i-cc" /></svg>
        </button>
        <button type="button" class="player-button" data-player-mute aria-pressed="false" aria-label="Mute" data-i18n-attr="aria-label:player.mute">
          <svg class="icon icon-volume" aria-hidden="true"><use href="${ICONS}#i-volume" /></svg>
          <svg class="icon icon-volume-off" aria-hidden="true"><use href="${ICONS}#i-volume-off" /></svg>
        </button>
        <button type="button" class="player-button" data-player-fullscreen aria-pressed="false" aria-label="Full screen" data-i18n-attr="aria-label:player.fullscreen">
          <svg class="icon icon-expand" aria-hidden="true"><use href="${ICONS}#i-expand" /></svg>
          <svg class="icon icon-collapse" aria-hidden="true"><use href="${ICONS}#i-collapse" /></svg>
        </button>
      </div>
    </div>`;

  function buildDialog() {
    if (typeof HTMLDialogElement !== "function") return;
    dialog = el("dialog", "v-dialog");
    dialog.setAttribute("aria-labelledby", "v-dialog-title");
    dialog.innerHTML = `
      <div class="v-dialog-media">${PLAYER_HTML}</div>
      <div class="v-dialog-info">
        <div class="v-dialog-head">
          <h2 id="v-dialog-title"></h2>
          <button type="button" class="icon-button v-close" autofocus aria-label="Close" data-i18n-attr="aria-label:gallery.close">
            <svg class="icon" aria-hidden="true"><use href="${ICONS}#i-close" /></svg>
          </button>
        </div>
        <p class="v-meta v-dialog-meta"></p>
        <p class="v-dialog-desc"></p>
        <p class="v-tags v-dialog-tags"></p>
        <p class="video-made v-dialog-made">
          <span class="video-made-label" data-i18n="showcase.madeWith">Made with</span>
        </p>
        <div class="v-dialog-actions">
          <button type="button" class="button button-secondary v-copy">
            <span data-i18n="gallery.copy">Copy link</span>
          </button>
        </div>
      </div>`;
    document.body.append(dialog);
    player = window.FramebopPlayer
      ? window.FramebopPlayer.create(dialog.querySelector("[data-player]"))
      : null;

    dialog.querySelector(".v-close").addEventListener("click", () => {
      dialog.close();
    });
    // A click on the dimmed backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (player) player.unload();
      current = null;
      if (location.hash.startsWith("#v=")) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    });
    dialog.querySelector(".v-copy").addEventListener("click", copyLink);
  }

  function fillDialog(item) {
    dialog.querySelector("#v-dialog-title").textContent = localized(item.title);

    const meta = dialog.querySelector(".v-dialog-meta");
    meta.replaceChildren();
    if (item.by) meta.append(maker(item));
    for (const part of [
      item.duration,
      item.language && languageName(item.language),
      formatDate(item),
    ]) {
      if (part) meta.append(el("span", "", part));
    }

    const desc = dialog.querySelector(".v-dialog-desc");
    desc.textContent = localized(item.description);
    desc.hidden = !desc.textContent;

    const tags = dialog.querySelector(".v-dialog-tags");
    tags.replaceChildren(
      ...item.tags.map((tag) => el("span", "tag", tagName(tag))),
    );
    tags.hidden = item.tags.length === 0;

    const made = dialog.querySelector(".v-dialog-made");
    for (const chip of made.querySelectorAll(".chip")) chip.remove();
    for (const name of item.madeWith) made.append(el("span", "chip", name));
    made.hidden = item.madeWith.length === 0;
  }

  function openVideo(item, autoplay) {
    if (!dialog || !player) {
      location.href = item.src;
      return;
    }
    current = item;
    fillDialog(item);
    player.load({
      src: item.src,
      poster: item.poster,
      captions: item.captions,
      srclang: item.language,
      label: item.language ? languageName(item.language) : "",
      title: localized(item.title),
    });
    if (!dialog.open) dialog.showModal();
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#v=${encodeURIComponent(item.id)}`,
    );
    if (autoplay) player.play();
  }

  async function copyLink() {
    if (!current) return;
    const url = `${location.origin}${VIDEOS_PATH}#v=${encodeURIComponent(current.id)}`;
    const label = dialog.querySelector(".v-copy span");
    try {
      await navigator.clipboard.writeText(url);
      label.textContent = t("gallery.copied", "Copied");
    } catch {
      label.textContent = url;
    }
    setTimeout(() => {
      label.textContent = t("gallery.copy", "Copy link");
    }, 2000);
  }

  function openFromHash() {
    const match = location.hash.match(/^#v=(.+)$/);
    if (!match) return;
    const item = byId.get(decodeURIComponent(match[1]));
    if (item) openVideo(item, false);
  }

  // ---------- Home page: the first few videos ----------

  function setupHome(root) {
    const list = root.querySelector("[data-gallery-preview]");
    if (!list || items.length === 0) return null;
    for (const node of root.querySelectorAll("[data-showcase-empty]")) {
      node.hidden = true;
    }
    for (const node of root.querySelectorAll("[data-showcase-filled]")) {
      node.hidden = false;
    }
    return function render() {
      const top = [...items].sort(byFeatured).slice(0, HOME_COUNT);
      list.replaceChildren(...top.map((item) => card(item, VIDEOS_PATH)));
      for (const total of root.querySelectorAll("[data-gallery-total]")) {
        total.textContent = String(items.length);
      }
    };
  }

  // ---------- /videos: search, filters, sorting ----------

  function setupGallery(root) {
    const grid = root.querySelector("[data-gallery-grid]");
    if (!grid) return null;
    if (items.length === 0) return null;

    for (const node of root.querySelectorAll("[data-gallery-empty]")) {
      node.hidden = true;
    }
    for (const node of root.querySelectorAll("[data-gallery-filled]")) {
      node.hidden = false;
    }

    const search = root.querySelector("[data-gallery-search]");
    const narration = root.querySelector("[data-gallery-narration]");
    const sort = root.querySelector("[data-gallery-sort]");
    const tagRow = root.querySelector("[data-gallery-tags]");
    const count = root.querySelector("[data-gallery-count]");
    const none = root.querySelector("[data-gallery-none]");
    const more = root.querySelector("[data-gallery-more]");
    const clear = root.querySelector("[data-gallery-clear]");

    const params = new URLSearchParams(location.search);
    const state = {
      q: params.get("q") || "",
      tag: params.get("tag") || "",
      narration: params.get("narration") || "",
      sort: params.get("sort") === "newest" ? "newest" : "featured",
      limit: PAGE_SIZE,
    };
    const haystack = new Map(items.map((item) => [item, searchText(item)]));

    // Topics, most used first; narration languages in list order.
    const tagCounts = new Map();
    for (const item of items) {
      for (const tag of item.tags)
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    const allTags = [...tagCounts.keys()].sort(
      (a, b) => tagCounts.get(b) - tagCounts.get(a) || a.localeCompare(b),
    );
    const allLanguages = [
      ...new Set(items.map((i) => i.language).filter(Boolean)),
    ];

    if (!allTags.includes(state.tag)) state.tag = "";
    search.value = state.q;
    sort.value = state.sort;

    function syncUrl() {
      const next = new URLSearchParams(location.search);
      for (const key of ["q", "tag", "narration", "sort"]) {
        const value =
          key === "sort" && state.sort === "featured" ? "" : state[key];
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const query = next.toString();
      history.replaceState(
        null,
        "",
        `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
      );
    }

    function renderControls() {
      // Narration languages: keep the first, translated "any" option.
      const keep = narration.options[0];
      narration.replaceChildren(keep);
      for (const code of allLanguages) {
        const option = el("option", "", languageName(code));
        option.value = code;
        narration.append(option);
      }
      narration.value = allLanguages.includes(state.narration)
        ? state.narration
        : "";

      tagRow.replaceChildren();
      tagRow.hidden = allTags.length === 0;
      for (const tag of ["", ...allTags]) {
        const button = el(
          "button",
          "tag-filter",
          tag ? tagName(tag) : t("gallery.allTopics", "All"),
        );
        button.type = "button";
        button.setAttribute("aria-pressed", String(state.tag === tag));
        button.addEventListener("click", () => {
          state.tag = tag;
          state.limit = PAGE_SIZE;
          for (const other of tagRow.children) {
            other.setAttribute("aria-pressed", String(other === button));
          }
          update();
        });
        tagRow.append(button);
      }
    }

    function results() {
      const words = fold(state.q).split(/\s+/).filter(Boolean);
      return items
        .filter(
          (item) =>
            (!state.tag || item.tags.includes(state.tag)) &&
            (!state.narration || item.language === state.narration) &&
            words.every((word) => haystack.get(item).includes(word)),
        )
        .sort(state.sort === "newest" ? byNewest : byFeatured);
    }

    function update() {
      const found = results();
      grid.replaceChildren(
        ...found.slice(0, state.limit).map((item) => card(item, "")),
      );
      count.textContent = countText(found.length);
      none.hidden = found.length > 0;
      more.hidden = found.length <= state.limit;
      syncUrl();
    }

    let typing = 0;
    search.addEventListener("input", () => {
      clearTimeout(typing);
      typing = setTimeout(() => {
        state.q = search.value.trim();
        state.limit = PAGE_SIZE;
        update();
      }, 150);
    });
    narration.addEventListener("change", () => {
      state.narration = narration.value;
      state.limit = PAGE_SIZE;
      update();
    });
    sort.addEventListener("change", () => {
      state.sort = sort.value;
      update();
    });
    more.addEventListener("click", () => {
      state.limit += PAGE_SIZE;
      update();
    });
    clear.addEventListener("click", () => {
      Object.assign(state, { q: "", tag: "", narration: "", limit: PAGE_SIZE });
      search.value = "";
      renderControls();
      update();
      search.focus();
    });

    return function render() {
      renderControls();
      update();
    };
  }

  // ---------- Start ----------

  const renders = [];
  for (const root of document.querySelectorAll("[data-gallery-root]")) {
    const render = setupHome(root) || setupGallery(root);
    if (render) renders.push(render);
  }
  if (items.length > 0) buildDialog();

  function renderAll() {
    for (const render of renders) render();
    if (current && dialog && dialog.open) fillDialog(current);
  }

  renderAll();
  // main.js sets the language after this script has run; render again then.
  document.addEventListener("framebop:language", renderAll);
  window.addEventListener("hashchange", openFromHash);
  if (location.hash.startsWith("#v=")) {
    document.addEventListener("framebop:language", openFromHash, {
      once: true,
    });
  }
})();
