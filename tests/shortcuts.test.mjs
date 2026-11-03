import assert from "node:assert/strict";
import test from "node:test";
import { setupDesktopScoreScale } from "../src/runtime/desktop-score-scale.js";
import {
  matchesRendererShortcut,
  normalizeRendererShortcuts,
  shortcutFromKeyboardEvent,
} from "../src/core/renderer-shortcuts.js";

function keyboardEvent(key, modifiers = {}) {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

test("桌面 Ctrl+滚轮沿用乐谱缩放步长与上下限，不拦截普通滚动", () => {
  const target = new EventTarget();
  let scale = 100, changes = 0;
  const destroy = setupDesktopScoreScale({ target, getScale: () => scale,
    updateScale: next => { scale = next; changes++; } });
  function wheel(deltaY, modifiers = {}) {
    const event = new Event("wheel", { cancelable: true });
    Object.assign(event, { deltaY, ctrlKey: true, ...modifiers });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }
  assert.equal(wheel(-120), true);
  assert.equal(scale, 105);
  assert.equal(wheel(1), true);
  assert.equal(scale, 100);
  target.dataset = { fixedScale: "true" };
  assert.equal(wheel(-120), true);
  assert.equal(scale, 100);
  target.dataset.fixedScale = "false";
  for (const modifiers of [{ ctrlKey: false }, { altKey: true }, { metaKey: true }]) assert.equal(wheel(-120, modifiers), false);
  assert.equal(wheel(0), false);
  assert.equal(scale, 100);
  for (let i = 0; i < 80; i++) wheel(-120);
  assert.equal(scale, 300);
  const atMaximum = changes;
  assert.equal(wheel(-120), true);
  assert.equal(changes, atMaximum);
  for (let i = 0; i < 80; i++) wheel(120);
  assert.equal(scale, 50);
  destroy();
  assert.equal(wheel(-120), false);
  assert.equal(scale, 50);
});

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
