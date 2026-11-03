import { createRendererScrollStrip } from "./renderer-scroll-strip.js";
import "./renderer-presentation.css";

/** Shared fullscreen modes, with media capabilities supplied only by desktop. */
export function createRendererPresentation({ panel, canvas, fullscreenButton, fileButton, tr, enter, videoEnabled = false, onModeChange, onGeometryChange, onChooseVideo, getPreviousEntry, getPlaybackEntries }) {
  const modes = videoEnabled ? ["default", "scroll", "video"] : ["default", "scroll"];
  let video = null, videoFrame = null, picker = null;
  if (videoEnabled) {
    video = document.createElement("video");
    video.className = "renderer-presentation-video";
    video.playsInline = true;
    video.controls = false;
    videoFrame = document.createElement("div");
    videoFrame.className = "renderer-presentation-video-frame";
    videoFrame.append(video); panel.append(videoFrame);
    picker = document.createElement("button");
    picker.type = "button"; picker.id = "rendererVideoFile"; picker.className = "renderer-icon-button";
    // Original clapperboard artwork on the navigation's existing 24px stroke grid.
    picker.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18v10H3zM3 10 2 5l18-3 1 5zM7 4l4 4m3-5 4 4M9 14l5 2-5 2z"/></svg>';
    fileButton.after(picker);
    picker.addEventListener("click", () => void onChooseVideo?.());
  }
  const control = document.createElement("div"); control.className = "renderer-presentation-control";
  fullscreenButton.before(control); control.append(fullscreenButton);
  const menu = document.createElement("div"); menu.className = "renderer-presentation-menu";
  menu.id = "rendererPresentationMenu"; menu.setAttribute("role", "menu");
  fullscreenButton.setAttribute("aria-haspopup", "menu");
  fullscreenButton.setAttribute("aria-controls", menu.id);
  const choices = modes.map(mode => {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.mode = mode; button.setAttribute("role", "menuitemradio");
    button.addEventListener("click", () => { setMode(mode); enter(); control.classList.add("is-dismissed"); fullscreenButton.focus(); });
    menu.append(button); return button;
  });
  control.append(menu);
  control.addEventListener("pointerleave", () => control.classList.remove("is-dismissed"));
  control.addEventListener("keydown", event => {
    if (event.key === "Escape" && !control.classList.contains("is-dismissed")) { event.preventDefault(); event.stopPropagation(); control.classList.add("is-dismissed"); fullscreenButton.focus(); }
  });
  const strip = createRendererScrollStrip({ panel, canvas, onGeometryChange, getPlaybackEntries });
  let mode = "default", active = false, latestState = null, latestEntry = null, previousEntry = null;

  function applyMode() {
    panel.dataset.presentationMode = active ? mode : "default";
    strip.setActive(active && mode !== "default");
    onModeChange?.(active && mode !== "default", mode);
    refreshLocale();
    if (latestState) update(latestState, latestEntry);
  }
  function setMode(value) {
    if (!modes.includes(value) || value === mode) return;
    mode = value;
    applyMode();
  }
  function update(state, entry) {
    latestState = state;
    if (entry !== latestEntry) previousEntry = getPreviousEntry(entry);
    latestEntry = entry;
    picker?.classList.toggle("has-file", state.videoReady === true);
    if (video) video.hidden = !state.videoReady;
    strip.update(state, entry, previousEntry);
  }
  function refreshLocale() {
    if (picker) { picker.title = tr("rendererVideoFile"); picker.setAttribute("aria-label", picker.title); }
    for (const choice of choices) {
      choice.textContent = tr(`rendererPresentation_${choice.dataset.mode}`);
      choice.setAttribute("aria-checked", String(choice.dataset.mode === mode));
    }
  }
  let width = 0, height = 0;
  const observer = new ResizeObserver(() => {
    if (panel.clientWidth === width && panel.clientHeight === height) return;
    width = panel.clientWidth; height = panel.clientHeight;
    strip.refresh();
  });
  observer.observe(panel);
  refreshLocale();
  return {
    mediaElement: video, update, setMode, getMode: () => mode, refreshLocale,
    refresh: strip.refresh,
    refreshContent: strip.refreshContent,
    async seekVideo(milliseconds) {
      if (!active || mode !== "video" || !video || !latestState?.videoReady || !Number.isFinite(video.duration)) return;
      const time = Math.min(Math.max(0, milliseconds / 1000), Math.max(0, video.duration - .001));
      if (Math.abs(video.currentTime - time) < .0001) return;
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); video.removeEventListener("seeked", ready); video.removeEventListener("error", failed); };
        const ready = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("videoPlaybackUnavailable")); };
        const timer = setTimeout(failed, 15000);
        video.addEventListener("seeked", ready, { once: true });
        video.addEventListener("error", failed, { once: true });
        video.currentTime = time;
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    setActive(value) { if (active === value) return; active = value; applyMode(); },
    destroy() { observer.disconnect(); strip.destroy(); picker?.remove(); videoFrame?.remove(); control.before(fullscreenButton); control.remove(); },
  };
}
