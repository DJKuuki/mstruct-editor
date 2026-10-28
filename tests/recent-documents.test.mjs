import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import recentModule from "../desktop/recent-documents.cjs";
import applicationUi from "../desktop/application-ui.cjs";
import { createDesktopDocumentAdapter } from "../src/runtime/desktop.js";
import { setupDocumentSession } from "../src/runtime/document-session.js";
const { createRecentDocuments, MAX_RECENT_DOCUMENTS } = recentModule;

test("最近文件记录按账户持久化、去重置顶、限量、移除及清空", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mstruct-recent-"));
  const store = createRecentDocuments(directory);
  assert.deepEqual(store.list(), []);
  for (let index = 0; index < 12; index++) store.record(path.join(directory, `曲目${index}.mstruct`));
  assert.equal(store.list().length, MAX_RECENT_DOCUMENTS);
  assert.equal(store.list()[0].name, "曲目11.mstruct");
  store.record(path.join(directory, "曲目8.mstruct"));
  assert.equal(store.list()[0].name, "曲目8.mstruct");
  assert.equal(store.list().length, MAX_RECENT_DOCUMENTS);
  const restarted = createRecentDocuments(directory);
  assert.deepEqual(restarted.list(), store.list());
  assert.equal(restarted.get("arbitrary-path"), null);
  const first = restarted.list()[0];
  assert.equal(restarted.get(first.id), path.join(directory, "曲目8.mstruct"));
  restarted.remove(first.id);
  assert.equal(restarted.get(first.id), null);
  const otherAccount = path.join(directory, "other-account");
  await mkdir(otherAccount);
  assert.deepEqual(createRecentDocuments(otherAccount).list(), []);
  restarted.clear();
  assert.deepEqual(createRecentDocuments(directory).list(), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "recent-documents.json"), "utf8")).paths, []);
});

test("最近文件读取过滤无效路径与重复项，写入失败保留原列表", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mstruct-recent-invalid-"));
  const document = path.join(directory, "Song.mstruct");
  await writeFile(path.join(directory, "recent-documents.json"), JSON.stringify({ version: 1, paths: [document, document.toUpperCase(), "relative.mstruct", null] }));
  const store = createRecentDocuments(directory);
  assert.equal(store.list().length, 1);
  await mkdir(path.join(directory, "recent-documents.json.tmp"));
  assert.throws(() => store.record(path.join(directory, "new.mstruct")));
  assert.equal(store.list()[0].name, "Song.mstruct");
});

test("原生最近文件菜单双语、同名目录可区分且只发送受限ID", () => {
  const commands = [], locale = applicationUi.createDesktopLocale("en");
  let cleared = false;
  const menu = () => applicationUi.applicationMenuTemplate({
    tr: locale.tr, sendDocumentCommand: command => commands.push(command),
    recentDocuments: [{ id: "abc", name: "A&B.mstruct", directory: "folder-one" }, { id: "def", name: "A&B.mstruct", directory: "folder-two" }],
    clearRecentDocuments: () => { cleared = true; },
  });
  const recent = menu()[0].submenu.find(item => item.label === "Recent Files");
  assert.match(recent.submenu[0].label, /A&&B.*folder-one/);
  assert.match(recent.submenu[1].label, /folder-two/);
  recent.submenu[0].click();
  assert.deepEqual(commands, ["open-recent:abc"]);
  recent.submenu.at(-1).click();
  assert.equal(cleared, true);
  locale.set("zh");
  assert.ok(menu()[0].submenu.some(item => item.label === "最近编辑的文件"));
  const empty = applicationUi.applicationMenuTemplate({ tr: locale.tr });
  assert.equal(empty[0].submenu.find(item => item.label === "最近编辑的文件").submenu[0].enabled, false);
});

test("最近文件复用载入、接受及关联流程，取消或载入失败不接受打开", async () => {
  let command, cancelled = false, loaded = true, accepted = 0, afterOpen = 0;
  const adapter = createDesktopDocumentAdapter({
    onCommand(callback) { command = callback; },
    async openRecentDocument(id) { assert.equal(id, "known-id"); return { cancelled, text: "source", name: "song.mstruct", token: "open-token" }; },
    async acceptOpenedDocument(token) { assert.equal(token, "open-token"); accepted++; return { name: "song.mstruct" }; },
  });
  const button = { addEventListener() {}, removeEventListener() {} };
  const session = setupDocumentSession({
    adapter, newButton: button, importButton: button, exportButton: button, importInput: button,
    isDirty: () => false, async loadDocument(text) { assert.equal(text, "source"); return { loaded, changed: false, scoreOk: true }; },
    markSaved() {}, afterOpen() { afterOpen++; }, setStatus() {}, tr: key => key,
  });
  const run = async () => { command("open-recent:known-id"); await new Promise(resolve => setImmediate(resolve)); };
  await run();
  assert.deepEqual([accepted, afterOpen], [1, 1]);
  cancelled = true; await run();
  cancelled = false; loaded = false; await run();
  assert.deepEqual([accepted, afterOpen], [1, 1]);
  session.destroy();
});
