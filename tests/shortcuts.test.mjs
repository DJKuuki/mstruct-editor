import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesRendererShortcut,
  normalizeRendererShortcuts,
  shortcutFromKeyboardEvent,
} from "../src/core/renderer-shortcuts.js";

function keyboardEvent(key, modifiers = {}) {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

test("渲染器快捷键接受功能键和至多三个组合键", () => {
  assert.deepEqual(shortcutFromKeyboardEvent(keyboardEvent("F2")), {
    binding: "F2",
    complete: true,
    tooLong: false,
  });
  assert.deepEqual(shortcutFromKeyboardEvent(keyboardEvent("p", { ctrlKey: true, altKey: true })), {
    binding: "Ctrl+Alt+P",
    complete: true,
    tooLong: false,
  });
  assert.equal(shortcutFromKeyboardEvent(keyboardEvent("p", { ctrlKey: true, altKey: true, shiftKey: true })).tooLong, true);
  assert.equal(shortcutFromKeyboardEvent(keyboardEvent("Control", { ctrlKey: true })).complete, false);
});

test("渲染器快捷键规范化并精确匹配修饰键", () => {
  assert.deepEqual(normalizeRendererShortcuts(null), {
    playPause: "Space",
    stop: "",
  });
  assert.deepEqual(normalizeRendererShortcuts({ playPause: "F2", stop: "Ctrl+S" }), {
    playPause: "F2",
    stop: "Ctrl+S",
  });
  assert.deepEqual(normalizeRendererShortcuts({ play: "Space", pause: "Space" }), {
    playPause: "Space",
    stop: "",
  });
  assert.deepEqual(normalizeRendererShortcuts({ playPause: "Space", stop: "Space" }), {
    playPause: "Space",
    stop: "",
  });
  assert.equal(matchesRendererShortcut(keyboardEvent("p", { ctrlKey: true }), "Ctrl+P"), true);
  assert.equal(matchesRendererShortcut(keyboardEvent("p", { ctrlKey: true, shiftKey: true }), "Ctrl+P"), false);
});
