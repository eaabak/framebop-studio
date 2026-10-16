/*
 * A small video player in the style of Apple's: a large frosted play button
 * over the poster, then a floating glass control bar that hides itself while
 * the video plays and the pointer rests. It wraps the browser's own <video>,
 * so decoding, captions and full screen stay native.
 *
 * Keys, while focus is inside the player: Space or K play and pause, M
 * mutes, F toggles full screen, C toggles captions, arrows move 5 seconds.
 *
 * FramebopPlayer.create(element) takes the player markup that gallery.js
 * builds and returns { load(source), unload(), play() }.
 */
(() => {
  "use strict";

  const HIDE_AFTER_MS = 2500;

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const s = String(total % 60).padStart(2, "0");
    const m = Math.floor(total / 60);
    if (m < 60) return `${m}:${s}`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`;
  }

  function create(player) {
    const video = player.querySelector("video");
    const big = player.querySelector("[data-player-big]");
    const bar = player.querySelector("[data-player-bar]");
    const toggle = player.querySelector("[data-player-toggle]");
    const seek = player.querySelector("[data-player-seek]");
    const elapsed = player.querySelector("[data-player-elapsed]");
    const remaining = player.querySelector("[data-player-remaining]");
    const captions = player.querySelector("[data-player-captions]");
    const mute = player.querySelector("[data-player-mute]");
    const full = player.querySelector("[data-player-fullscreen]");

    video.controls = false;
    player.classList.add("is-enhanced");
    let hideTimer = 0;
    let dragging = false;
    let track = null;

    function play() {
      const promise = video.play();
      if (promise && promise.catch) promise.catch(() => {});
    }

    function togglePlay() {
      if (video.paused || video.ended) play();
      else video.pause();
    }

    function showBar() {
      player.classList.add("show-bar");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideBar, HIDE_AFTER_MS);
    }

    function hideBar() {
      if (video.paused || dragging || bar.contains(document.activeElement)) {
        return;
      }
      player.classList.remove("show-bar");
    }

    function updateTime() {
      const duration = video.duration;
      const current = video.currentTime;
      if (Number.isFinite(duration) && duration > 0) {
        if (!dragging) seek.value = String(current);
        seek.style.setProperty("--fill", `${(current / duration) * 100}%`);
        seek.setAttribute(
          "aria-valuetext",
          `${formatTime(current)} / ${formatTime(duration)}`,
        );
        remaining.textContent = `-${formatTime(duration - current)}`;
      } else {
        seek.style.setProperty("--fill", "0%");
        remaining.textContent = "";
      }
      elapsed.textContent = formatTime(current);
    }

    function updateDuration() {
      if (Number.isFinite(video.duration)) seek.max = String(video.duration);
      updateTime();
    }

    function toggleMute() {
      video.muted = !video.muted;
    }

    function setCaptions(on) {
      if (track) track.mode = on ? "showing" : "hidden";
      captions.setAttribute("aria-pressed", String(on));
      player.classList.toggle("captions-on", on);
    }

    function toggleCaptions() {
      if (track) setCaptions(track.mode !== "showing");
    }

    function isFullscreen() {
      return (
        document.fullscreenElement === player ||
        document.webkitFullscreenElement === player
      );
    }

    function toggleFullscreen() {
      if (isFullscreen()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(
          document,
        );
      } else if (player.requestFullscreen) {
        player.requestFullscreen().catch(() => {});
      } else if (player.webkitRequestFullscreen) {
        player.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
        // iPhone: only the video itself can go full screen, with iOS controls.
        video.webkitEnterFullscreen();
      }
    }

    function onFullscreenChange() {
      const on = isFullscreen();
      player.classList.toggle("is-fullscreen", on);
      full.setAttribute("aria-pressed", String(on));
    }

    big.addEventListener("click", play);
    toggle.addEventListener("click", togglePlay);
    video.addEventListener("click", () => {
      togglePlay();
      showBar();
    });
    mute.addEventListener("click", toggleMute);
    captions.addEventListener("click", toggleCaptions);
    full.addEventListener("click", toggleFullscreen);

    video.addEventListener("play", () => {
      player.classList.add("is-started", "is-playing");
      toggle.setAttribute("aria-pressed", "true");
      // From now on the bar has its own play button.
      big.tabIndex = -1;
      big.setAttribute("aria-hidden", "true");
      showBar();
    });
    for (const type of ["pause", "ended"]) {
      video.addEventListener(type, () => {
        player.classList.remove("is-playing");
        toggle.setAttribute("aria-pressed", "false");
        showBar();
      });
    }
    video.addEventListener("loadedmetadata", updateDuration);
    video.addEventListener("durationchange", updateDuration);
    video.addEventListener("timeupdate", updateTime);
    video.addEventListener("volumechange", () => {
      player.classList.toggle("is-muted", video.muted);
      mute.setAttribute("aria-pressed", String(video.muted));
    });

    seek.addEventListener("input", () => {
      dragging = true;
      video.currentTime = Number(seek.value);
      updateTime();
    });
    seek.addEventListener("change", () => {
      dragging = false;
      showBar();
    });

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    player.addEventListener("pointermove", showBar);
    player.addEventListener("focusin", showBar);
    player.addEventListener("pointerleave", () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideBar, 600);
    });

    player.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const onButton = event.target instanceof HTMLButtonElement;
      const onSeek = event.target === seek;
      const key = event.key.toLowerCase();
      if ((key === " " && !onButton && !onSeek) || key === "k") {
        togglePlay();
      } else if (key === "m") {
        toggleMute();
      } else if (key === "f") {
        toggleFullscreen();
      } else if (key === "c") {
        toggleCaptions();
      } else if ((key === "arrowleft" || key === "arrowright") && !onSeek) {
        const step = key === "arrowleft" ? -5 : 5;
        video.currentTime = Math.max(0, video.currentTime + step);
      } else {
        return;
      }
      event.preventDefault();
      showBar();
    });

    function reset() {
      clearTimeout(hideTimer);
      player.classList.remove(
        "is-started",
        "is-playing",
        "show-bar",
        "captions-on",
      );
      toggle.setAttribute("aria-pressed", "false");
      big.tabIndex = 0;
      big.removeAttribute("aria-hidden");
      seek.value = "0";
      seek.max = "0";
      for (const old of video.querySelectorAll("track")) old.remove();
      track = null;
      captions.hidden = true;
      setCaptions(false);
    }

    // source: { src, poster, captions, srclang, label, title }
    function load(source) {
      video.pause();
      reset();
      video.poster = source.poster || "";
      video.src = source.src;
      video.setAttribute("aria-label", source.title || "");
      if (source.captions) {
        const element = document.createElement("track");
        element.kind = "captions";
        element.src = source.captions;
        element.srclang = source.srclang || "en";
        if (source.label) element.label = source.label;
        video.append(element);
        track = element.track;
        track.mode = "hidden";
        captions.hidden = false;
      }
      video.load();
      updateTime();
    }

    function unload() {
      video.pause();
      reset();
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.load();
      updateTime();
    }

    updateTime();
    return { load, unload, play };
  }

  window.FramebopPlayer = { create };
})();
