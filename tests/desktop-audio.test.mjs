import assert from "node:assert/strict";
import test from "node:test";
import { setupDesktopAudioRuntime } from "../src/runtime/desktop-audio.js";

test("repeated recording context shares its pending load without stopping or replacing audio", async t => {
  const commands = [], contexts = [];
  let finish, value = { stable: false, timeline: "first.mstructtime" };
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, blob: async () => new Blob(["audio"]) }));
  const audio = setupDesktopAudioRuntime({ context: () => ({ ...value }), command: (...args) => commands.push(args), api: {
    audioFind: context => { contexts.push(context); return new Promise(resolve => { finish = resolve; }); },
  } });
  const pending = audio.refresh();
  assert.equal(audio.refresh(), pending); assert.equal(contexts.length, 1);
  finish({ url: "test:first", name: "first.wav" }); await pending;
  const count = commands.length;
  await audio.refresh(); assert.equal(commands.length, count);
  assert.equal(commands.at(-1)[0], "bgm-file"); assert.equal(commands.at(-1)[1].name, "first.wav");
  value.timeline = "second.mstructtime";
  const second = audio.refresh();
  finish({ url: "test:second", name: "second.wav" }); await second;
  assert.equal(contexts.length, 2); assert.equal(commands.at(-1)[1].name, "second.wav");
  audio.clear();
  const reopened = audio.refresh();
  finish({ url: "test:reopened", name: "reopened.wav" }); await reopened;
  assert.equal(contexts.length, 3); assert.equal(commands.at(-1)[1].name, "reopened.wav");
});

test("switching or leaving documents rejects a late recording result", async t => {
  const commands = [], pending = [];
  let timeline = "first.mstructtime";
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, blob: async () => new Blob(["audio"]) }));
  const audio = setupDesktopAudioRuntime({ context: () => ({ stable: false, timeline }), command: (...args) => commands.push(args), api: {
    audioFind: () => new Promise(resolve => pending.push(resolve)),
  } });
  const first = audio.refresh(); timeline = "second.mstructtime";
  const second = audio.refresh();
  pending[1]({ url: "test:second", name: "second.wav" }); await second;
  const count = commands.length;
  pending[0]({ url: "test:first", name: "first.wav" }); await first;
  assert.equal(commands.length, count);
  audio.clear(); const reopened = audio.refresh(); audio.clear();
  pending[2]({ url: "test:late", name: "late.wav" }); await reopened;
  assert.equal(commands.filter(([name]) => name === "bgm-file").length, 1);
});
