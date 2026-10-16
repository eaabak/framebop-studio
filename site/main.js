/*
 * framebop.com: repository links, the language switch and the reveal on
 * scroll. No trackers, no cookies, no requests to other sites.
 *
 * Loaded last, after i18n.js and gallery.js, so the English text it collects
 * includes the markup gallery.js has added. When the language changes it
 * fires a "framebop:language" event on document, with { lang } as detail.
 */
(() => {
  "use strict";

  // The public GitHub repository. Every link with a data-repo attribute is
  // built from it; the attribute holds the path inside the repository. The
  // pages use the same URL in their plain hrefs, for visitors without
  // JavaScript, so change it there too if the repository moves.
  const REPO_URL = "https://github.com/eaabak/framebop-studio";

  const root = document.documentElement;
  root.classList.add("js");

  function applyRepoLinks() {
    for (const link of document.querySelectorAll("a[data-repo]")) {
      const path = link.getAttribute("data-repo");
      link.href = path ? `${REPO_URL}/${path}` : REPO_URL;
    }
  }

  // ---------- Language ----------

  const translations = window.FRAMEBOP_I18N || {};
  const languages = ["en", ...Object.keys(translations)];
  const storageKey = "framebop-lang";
  const metaDescription = document.querySelector('meta[name="description"]');
  // Each page has its own title and description keys: "meta.*" on the home
  // page, "<page>.meta.*" on a page with data-page on <html>.
  const metaPrefix = root.dataset.page ? `${root.dataset.page}.meta` : "meta";

  // English lives in the pages; remember it so switching back restores it.
  const english = {
    title: document.title,
    description: metaDescription ? metaDescription.content : "",
    text: new Map(),
    attrs: new Map(),
  };
  for (const el of document.querySelectorAll("[data-i18n]")) {
    english.text.set(el, el.innerHTML);
  }
  for (const el of document.querySelectorAll("[data-i18n-attr]")) {
    const values = {};
    for (const [attr] of parseAttrSpec(el)) {
      values[attr] = el.getAttribute(attr);
    }
    english.attrs.set(el, values);
  }

  function parseAttrSpec(el) {
    return el
      .getAttribute("data-i18n-attr")
      .split(";")
      .map((pair) => pair.split(":").map((part) => part.trim()))
      .filter(([attr, key]) => attr && key);
  }

  function setLanguage(lang) {
    if (!languages.includes(lang)) lang = "en";
    const dict = lang === "en" ? null : translations[lang];
    const t = (key, fallback) =>
      dict && typeof dict[key] === "string" ? dict[key] : fallback;

    for (const [el, html] of english.text) {
      el.innerHTML = t(el.getAttribute("data-i18n"), html);
    }
    for (const [el, values] of english.attrs) {
      for (const [attr, key] of parseAttrSpec(el)) {
        el.setAttribute(attr, t(key, values[attr]));
      }
    }
    document.title = t(`${metaPrefix}.title`, english.title);
    if (metaDescription) {
      metaDescription.content = t(
        `${metaPrefix}.description`,
        english.description,
      );
    }
    root.lang = lang;

    for (const button of document.querySelectorAll("[data-lang]")) {
      button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
    }
    applyRepoLinks();
    document.dispatchEvent(
      new CustomEvent("framebop:language", { detail: { lang } }),
    );
  }

  function storedLanguage() {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function storeLanguage(lang) {
    try {
      localStorage.setItem(storageKey, lang);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  }

  // A link can ask for a language (?lang=tr, or framebop.com/tr on Vercel);
  // then a choice made earlier on this device; then the browser's language.
  function initialLanguage() {
    const fromQuery = new URLSearchParams(location.search).get("lang");
    if (fromQuery && languages.includes(fromQuery)) return fromQuery;
    const fromPath = location.pathname.split("/").filter(Boolean)[0];
    if (fromPath && languages.includes(fromPath)) return fromPath;
    const stored = storedLanguage();
    if (stored && languages.includes(stored)) return stored;
    for (const preferred of navigator.languages || [navigator.language]) {
      const base = String(preferred).toLowerCase().split("-")[0];
      if (languages.includes(base)) return base;
    }
    return "en";
  }

  for (const button of document.querySelectorAll("[data-lang]")) {
    button.addEventListener("click", () => {
      setLanguage(button.dataset.lang);
      storeLanguage(button.dataset.lang);
    });
  }

  setLanguage(initialLanguage());

  // ---------- Reveal on scroll ----------

  const motionOk = window.matchMedia(
    "(prefers-reduced-motion: no-preference)",
  ).matches;
  if (motionOk && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    root.classList.add("motion");
    for (const el of document.querySelectorAll(".reveal")) observer.observe(el);
  }
})();
