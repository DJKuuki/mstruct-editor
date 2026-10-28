import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { setupDesktopTransition } from "../src/runtime/desktop-transition.js";
import { setupDocumentSession } from "../src/runtime/document-session.js";
const require = createRequire(import.meta.url);
const { createDocumentTransition } = require("../desktop/document-transition.cjs");
const { createDesktopLocale } = require("../desktop/application-ui.cjs");

function fixture() {
  const handlers = new Map(), prompts = [], requests = [], contents = new EventEmitter(), locale = createDesktopLocale("zh");
  let dirty = true, response = 0;
  contents.send = (channel, token) => requests.push({ channel, token });
  const window = { webContents: contents, isDestroyed: () => false };
  const guard = createDocumentTransition({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    assertTrustedSender: event => { if (event.sender !== contents) throw Error("Untrusted"); }, getWindow: () => window, isDirty: () => dirty,
    dialog: { async showMessageBox(_window, options) { prompts.push(options); return { response }; } }, tr: locale.tr });
  const reply = value => handlers.get("mstruct:complete-transition-save")({ sender: contents }, value);
  return { guard, locale, handlers, contents, prompts, requests, reply, dirty(value) { dirty = value; }, response(value) { response = value; } };
}

test("unsaved confirmation orders Save, Discard, Cancel; clean, discard and cancel never request a save", async () => {
  const f = fixture(); f.dirty(false); assert.equal(await f.guard.confirm("退出"), true); assert.equal(f.prompts.length, 0);
  f.dirty(true); f.response(2); assert.equal(await f.guard.confirm("退出"), false);
  assert.deepEqual(f.prompts[0].buttons, ["保存并退出", "不保存并退出", "取消"]);
  assert.equal(f.prompts[0].defaultId, 0); assert.equal(f.prompts[0].cancelId, 2);
  f.response(1); assert.equal(await f.guard.confirm("退出"), true);
  f.locale.set("en"); f.response(2); await f.guard.confirm("Quit");
  assert.deepEqual(f.prompts.at(-1).buttons, ["Save and Quit", "Discard and Quit", "Cancel"]); assert.equal(f.requests.length, 0);
});

test("Save and exit waits for its trusted matching completion and a clean workspace", async () => {
  const f = fixture(), result = f.guard.confirm("退出"); await Promise.resolve();
  const { token, channel } = f.requests[0]; assert.equal(channel, "mstruct:save-before-transition");
  assert.equal(await f.guard.confirm("返回曲库"), false, "another transition cannot overtake a save");
  assert.throws(() => f.handlers.get("mstruct:complete-transition-save")({ sender: {} }, { token, saved: true }), /Untrusted/);
  assert.equal(f.reply({ token: "stale", saved: true }), false);
  f.dirty(false); assert.equal(f.reply({ token, saved: true }), true); assert.equal(await result, true);
  assert.equal(f.reply({ token, saved: true }), false); assert.equal(f.contents.listenerCount("destroyed"), 0);
});

test("cancelled/failed saves, new edits and renderer loss all prevent the transition", async () => {
  for (const outcome of ["cancelled", "dirty", "destroyed", "render-process-gone"]) {
    const f = fixture(), result = f.guard.confirm("退出"); await Promise.resolve();
    if (["destroyed", "render-process-gone"].includes(outcome)) f.contents.emit(outcome);
    else f.reply({ token: f.requests[0].token, saved: outcome !== "cancelled" });
    assert.equal(await result, false, outcome); assert.equal(f.contents.listenerCount("destroyed"), 0);
  }
});

test("desktop saves dirty timeline before analysis; cancellation, errors and edits keep the workspace open", async () => {
  for (const outcome of ["success", "timeline-cancel", "analysis-cancel", "error", "edited"]) {
    let callback, analysis = true, timeline = true; const order = [], replies = [];
    setupDesktopTransition({ api: { onSaveBeforeTransition: listener => { callback = listener; }, async completeTransitionSave(result) { replies.push(result); } },
      isAnalysisDirty: () => analysis, isTimelineDirty: () => timeline,
      async saveTimeline() { order.push("timeline"); if (outcome === "error") throw Error("write"); if (outcome === "timeline-cancel") return false; timeline = false; return true; },
      session: () => ({ async save() { order.push("analysis"); if (outcome === "analysis-cancel") return false; analysis = outcome === "edited"; return true; } }) });
    await callback("request");
    assert.deepEqual(order, ["timeline", ...(["timeline-cancel", "error"].includes(outcome) ? [] : ["analysis"])]);
    assert.deepEqual(replies, [{ token: "request", saved: outcome === "success" }]);
  }
});

test("document save reports success only after hooks and retains edits made while writing", async () => {
  const button = { addEventListener() {}, removeEventListener() {} };
  let current = "first", baseline = "old", mode = "ok", after = false;
  const session = setupDocumentSession({ adapter: { kind: "desktop", onCommand() {}, async save() {
    if (mode === "cancel") return { cancelled: true };
    if (mode === "error") throw Error("disk");
    if (mode === "edit") current = "second";
    return { name: "Analysis.mstruct" };
  } }, newButton: button, importButton: button, exportButton: button, importInput: button,
    isDirty: () => current !== baseline, serializeDocument: () => current, captureSaveState: () => current, suggestedName: () => "Analysis.mstruct",
    markSaved: state => { baseline = state; }, afterSave: async () => { await Promise.resolve(); after = true; }, setStatus() {}, tr: key => key });
  assert.equal(await session.save(), true); assert.equal(after, true); assert.equal(baseline, "first");
  for (const value of ["cancel", "error", "edit"]) { mode = value; current = "first"; assert.equal(await session.save(), false, value); }
  assert.equal(baseline, "first"); assert.equal(current, "second"); session.destroy();
});
