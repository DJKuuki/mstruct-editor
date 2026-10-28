export const DEFAULT_RENDERER_SCALE = 100;
export const MIN_RENDERER_SCALE = 50;
export const MAX_RENDERER_SCALE = 300;
export const RENDERER_SCALE_STEP = 5;
export const SCORE_BASE_FONT_SIZE = 16;
export const RENDERER_SCALE_STORAGE_KEY = "mstruct-renderer-scale";
const changeEvent = "mstruct-renderer-scale-change";
let currentScale;

export function normalizeRendererScale(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RENDERER_SCALE;
  return Math.min(MAX_RENDERER_SCALE, Math.max(MIN_RENDERER_SCALE,
    Math.round(value / RENDERER_SCALE_STEP) * RENDERER_SCALE_STEP));
}

export function readRendererScale(storage) {
  try {
    const source = storage ?? globalThis.localStorage;
    return normalizeRendererScale(JSON.parse(source?.getItem(RENDERER_SCALE_STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_RENDERER_SCALE;
  }
}

/** A device display setting, independent of musical preferences and export settings. */
export function getRendererScaleSnapshot() {
  currentScale ??= readRendererScale();
  return currentScale;
}

export function writeRendererScale(value) {
  currentScale = normalizeRendererScale(value);
  try { globalThis.localStorage?.setItem(RENDERER_SCALE_STORAGE_KEY, JSON.stringify(currentScale)); } catch { /* Display changes still work without storage. */ }
  globalThis.window?.dispatchEvent(new Event(changeEvent));
  return currentScale;
}

export function subscribeRendererScale(onChange) {
  const storageChanged = (event) => {
    if (event.key !== null && event.key !== RENDERER_SCALE_STORAGE_KEY) return;
    currentScale = readRendererScale();
    onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", storageChanged);
  };
}

/** Widths are engraved at 16px; resolve them against the score's current base size. */
export function scoreLength(value) {
  return `calc(${value / SCORE_BASE_FONT_SIZE} * var(--score-font-size, 16px))`;
}
