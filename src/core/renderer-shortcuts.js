export const RENDERER_SHORTCUTS_STORAGE_KEY = "mstruct-renderer-shortcuts";
export const RENDERER_SHORTCUTS_EVENT = "mstruct-renderer-shortcuts-changed";
export const RENDERER_SHORTCUT_ACTIONS = ["playPause", "stop"];

const MODIFIER_LABELS = new Map([
  ["Control", "Ctrl"],
  ["Alt", "Alt"],
  ["Shift", "Shift"],
  ["Meta", "Meta"],
]);

export function normalizeRendererShortcuts(value) {
  const candidate = value && typeof value === "object" ? value : {};
  const legacyShared = typeof candidate.play === "string"
    && candidate.play
    && candidate.play === candidate.pause
    ? candidate.play
    : "";
  const playPause = typeof candidate.playPause === "string" ? candidate.playPause : (legacyShared || "Space");
  const stop = typeof candidate.stop === "string" && candidate.stop !== playPause ? candidate.stop : "";
  return { playPause, stop };
}

function primaryKeyLabel(event) {
  if (MODIFIER_LABELS.has(event.key)) return "";
  if (event.key === " ") return "Space";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

export function shortcutFromKeyboardEvent(event) {
  const keys = [];
  if (event.ctrlKey) keys.push("Ctrl");
  if (event.altKey) keys.push("Alt");
  if (event.shiftKey) keys.push("Shift");
  if (event.metaKey) keys.push("Meta");
  const primary = primaryKeyLabel(event);
  if (primary) keys.push(primary);
  return { binding: keys.join("+"), complete: Boolean(primary), tooLong: keys.length > 3 };
}

export function matchesRendererShortcut(event, binding) {
  if (!binding) return false;
  return shortcutFromKeyboardEvent(event).binding === binding;
}

export function isEditableShortcutTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function readRendererShortcuts(storage) {
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return normalizeRendererShortcuts(JSON.parse(target?.getItem(RENDERER_SHORTCUTS_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeRendererShortcuts(null);
  }
}

export function writeRendererShortcuts(value, storage) {
  const normalized = normalizeRendererShortcuts(value);
  const target = storage ?? window.localStorage;
  target.setItem(RENDERER_SHORTCUTS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(RENDERER_SHORTCUTS_EVENT, { detail: normalized }));
  return normalized;
}
