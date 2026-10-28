import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { APPLICATION_COLOR_SCHEMES, normalizeApplicationColorScheme } from "../src/core/application-theme.js";

const require = createRequire(import.meta.url);
const { configureUserData, requestUserDataReset } = require("../desktop/user-data.cjs");
const { setupUserDataIpc } = require("../desktop/user-data-ipc.cjs");
const { createDesktopLocale } = require("../desktop/application-ui.cjs");
const scratch = fileURLToPath(new URL("../.test-tmp/", import.meta.url)); mkdirSync(scratch, { recursive: true });

function instance() {
  const paths = {};
  return { paths, getPath(key) { throw Error(`Unexpected directory lookup: ${key}`); }, setPath(key, value) { paths[key] = value; } };
}

test("fixed LocalAppData storage retains preferences and library location across app versions without directory discovery", () => {
  const root = mkdtempSync(path.join(scratch, "user-data-"));
  try {
    const localAppData = path.join(root, "account", "Local"), first = instance();
    const directory = configureUserData(first, { localAppData });
    assert.equal(directory, path.join(localAppData, "MStruct", "Analysis Editor"));
    for (const key of ["userData", "sessionData", "logs", "crashDumps"]) assert.ok(first.paths[key].startsWith(directory));
    mkdirSync(path.join(directory, "chromium", "Local Storage"), { recursive: true });
    writeFileSync(path.join(directory, "chromium", "Local Storage", "settings"), "saved preferences");
    for (const file of ["library.json", "audio-associations.json", "recent-documents.json"]) writeFileSync(path.join(directory, file), "saved state");
    const upgraded = instance();
    assert.equal(configureUserData(upgraded, { localAppData }), directory);
    assert.equal(readFileSync(path.join(directory, "chromium", "Local Storage", "settings"), "utf8"), "saved preferences");
    for (const file of ["library.json", "audio-associations.json", "recent-documents.json"]) assert.equal(readFileSync(path.join(directory, file), "utf8"), "saved state");
    const other = configureUserData(instance(), { localAppData: path.join(root, "other-account", "Local") });
    assert.notEqual(other, directory); assert.ok(!existsSync(path.join(other, "library.json")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("isolated smoke data initializes only its explicitly supplied directory", () => {
  const root = mkdtempSync(path.join(scratch, "isolated-data-"));
  try {
    const isolated = path.join(root, "smoke");
    assert.equal(configureUserData(instance(), { isolatedDirectory: isolated }), isolated);
    assert.ok(existsSync(path.join(isolated, "user-data.json")));
    assert.ok(!existsSync(path.join(isolated, "mstruct-profiles")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("reset waits for restart and directory ownership, clears app state and preserves library files", () => {
  const root = mkdtempSync(path.join(scratch, "reset-data-"));
  try {
    const options = { isolatedDirectory: path.join(root, "app-data") };
    const directory = configureUserData(instance(), options);
    writeFileSync(path.join(directory, "library.json"), "saved location");
    const music = path.join(directory, "My library"); mkdirSync(path.join(music, ".mstruct-library"), { recursive: true });
    for (const file of ["score.mstruct", "recording.mp3", ".mstruct-library/state.json"]) writeFileSync(path.join(music, file), "preserve");
    requestUserDataReset(directory);
    assert.ok(existsSync(path.join(directory, "library.json")), "reset is deferred until restart");
    assert.equal(configureUserData(instance(), { ...options, claimDirectory: () => false }), null);
    assert.ok(existsSync(path.join(directory, "reset-pending.json"))); assert.ok(existsSync(path.join(directory, "library.json")));
    configureUserData(instance(), options);
    assert.ok(!existsSync(path.join(directory, "library.json"))); assert.ok(!existsSync(path.join(directory, "reset-pending.json")));
    configureUserData(instance(), options); assert.ok(!existsSync(path.join(directory, "library.json")));
    for (const file of ["score.mstruct", "recording.mp3", ".mstruct-library/state.json"]) assert.equal(readFileSync(path.join(music, file), "utf8"), "preserve");
    assert.throws(() => requestUserDataReset(root), /Unrecognized/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("user data IPC opens only its own folder, rejects untrusted senders and requires discard and clear confirmation", async () => {
  const root = mkdtempSync(path.join(scratch, "reset-ipc-"));
  try {
    const directory = configureUserData({ getPath: () => root, setPath() {} }, { isolatedDirectory: path.join(root, "isolated") });
    const handlers = new Map(), opened = [], prompts = [], lifecycle = [], locale = createDesktopLocale("zh");
    let discard = false, response = 0;
    setupUserDataIpc({ app: { getPath: () => directory, relaunch: () => lifecycle.push("relaunch"), quit: () => lifecycle.push("quit") },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, shell: { openPath: async value => { opened.push(value); return ""; } },
      dialog: { showMessageBox: async (_window, options) => { prompts.push(options); return { response }; } }, getWindow: () => ({}),
      assertTrustedSender: event => { if (!event?.trusted) throw Error("untrusted"); }, confirmDiscard: async () => discard, beforeRestart: () => lifecycle.push("allow close"), tr: locale.tr });
    const open = handlers.get("mstruct-user-data:open"), clear = handlers.get("mstruct-user-data:clear");
    await assert.rejects(open({}), /untrusted/); await assert.rejects(clear({}), /untrusted/);
    await open({ trusted: true }, "arbitrary path"); assert.deepEqual(opened, [directory]);
    assert.deepEqual(await clear({ trusted: true }), { cancelled: true }); assert.equal(prompts.length, 0);
    discard = true;
    assert.deepEqual(await clear({ trusted: true }), { cancelled: true }); assert.equal(prompts[0].defaultId, 0); assert.equal(prompts[0].cancelId, 0);
    assert.ok(!existsSync(path.join(directory, "reset-pending.json"))); assert.equal(lifecycle.length, 0);
    locale.set("en"); response = 1;
    assert.deepEqual(await clear({ trusted: true }), { restarting: true });
    assert.equal(prompts[1].message, "Clear user data and restart?"); assert.match(prompts[1].detail, /sync records.*kept/);
    assert.deepEqual(lifecycle, ["allow close", "relaunch", "quit"]); assert.ok(existsSync(path.join(directory, "reset-pending.json")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the application palette defaults to ink blue and accepts the three preview colors", () => {
  assert.equal(normalizeApplicationColorScheme(null), "ink-blue");
  assert.equal(normalizeApplicationColorScheme("unknown"), "ink-blue");
  for (const value of APPLICATION_COLOR_SCHEMES) assert.equal(normalizeApplicationColorScheme(value), value);
});
