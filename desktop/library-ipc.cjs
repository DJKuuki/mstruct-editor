const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createLibraryStore } = require("./library-store.cjs");
const { readPublicZip, MAX_BYTES } = require("./library-zip.cjs");
const { safePath, validName, readOptional } = require("./library-paths.cjs");
const { atomicWrite } = require("./library-transaction.cjs");
const { readExtractedPackage } = require("./library-extracted.cjs");

function setupLibraryIpc({ ipcMain, dialog, shell, userData, window, assertTrustedSender, confirmDiscard, prepareOpen, currentPath, setPath, locale, relocateAudio }) {
  const preference = path.join(userData, "library.json"), pending = new Map();
  let store, queue = Promise.resolve();
  const copy = (zh, en) => locale() === "en" ? en : zh;
  async function active() {
    if (store) return store;
    const data = await readOptional(preference);
    if (!data) return null;
    const saved = JSON.parse(data);
    store = createLibraryStore(saved.root); await store.load(); return store;
  }
  async function requireStore() { const library = await active(); if (!library) throw Error("library-select"); return library; }
  async function guard() { return confirmDiscard(copy("返回曲库", "return to library")); }
  const operations = {
    async state() { const library = await active(); return library ? { root: library.root } : null; },
    async choose() {
      const selected = await dialog.showOpenDialog(window(), { title: copy("选择或建立本地曲库", "Choose or create a local library"), properties: ["openDirectory", "createDirectory"] });
      if (selected.canceled) return { cancelled: true };
      const candidate = createLibraryStore(await fs.realpath(selected.filePaths[0]));
      await candidate.load();
      await atomicWrite(preference, JSON.stringify({ root: candidate.root }));
      store = candidate; pending.clear(); setPath(null);
      return { root: store.root };
    },
    async leave() { setPath(null); return { cancelled: false }; },
    async scan() { return (await requireStore()).scan(); },
    async rules() { return (await requireStore()).rules(); },
    async extracted() {
      const library = await requireStore(), snapshot = await library.scan();
      if (snapshot.state.snapshot || Object.keys(snapshot.state.sources).length) return null;
      const bundle = await readExtractedPackage(library.root); if (!bundle) return null;
      const token = randomUUID(); pending.clear(); pending.set(token, { bundle });
      return { token, catalog: bundle.catalog, modified: bundle.modified,
        texts: Object.fromEntries([...bundle.files].filter(([, data]) => data !== null).map(([key, data]) => [key, data.toString("utf8")])) };
    },
    async adopt(token) {
      const item = pending.get(token); if (!item?.bundle.extracted) throw Error("library-stale");
      const result = await (await requireStore()).adoptExtracted(item.bundle); pending.delete(token); return result;
    },
    async cache(value) {
      if (!value || typeof value !== "object" || JSON.stringify(value).length > 128 * 1024 * 1024) throw Error("library-size");
      return (await requireStore()).writeCache(value);
    },
    async open(relative) {
      return prepareOpen(await safePath((await requireStore()).root, relative));
    },
    async folder(value) { return (await requireStore()).createFolder(value.parent, value.name); },
    async create(value) {
      if (typeof value.text !== "string" || Buffer.byteLength(value.text) > 16 * 1024 * 1024) throw Error("library-size");
      const library = await requireStore(), relative = await library.createAnalysis(value.folder, value.name, value.text);
      return { path: relative };
    },
    async rename(value) {
      const library = await requireStore(), original = await safePath(library.root, value.path);
      if (value.folder) { const next = await library.renameFolder(value.path, value.name); await relocateAudio(original, await safePath(library.root, next)); return { path: next }; }
      if (!validName(value.name) || typeof value.text !== "string" || Buffer.byteLength(value.text) > 16 * 1024 * 1024) throw Error("library-name");
      const parent = path.posix.dirname(value.path), relative = `${parent === "." ? "" : `${parent}/`}${value.name}.mstruct`;
      const next = await library.renameFile(value.path, relative, value.text);
      await relocateAudio(original, next);
      if (currentPath() === original) setPath(next);
      return { path: relative };
    },
    async trash(relative) {
      const result = await dialog.showMessageBox(window(), { type: "warning", message: copy("删除此项目？", "Delete this item?"), detail: `${relative}\n${copy("文件会移到 Windows 回收站，可从系统回收站恢复。", "Files will move to the Windows Recycle Bin and can be restored there.")}`,
        buttons: [copy("删除", "Delete"), copy("取消", "Cancel")], defaultId: 1, cancelId: 1, noLink: true });
      if (result.response !== 0) return { cancelled: true };
      const library = await requireStore(); await library.remove(relative, file => shell.trashItem(file));
      if (currentPath() && library.relativeOf(currentPath())?.startsWith(relative)) setPath(null);
      return { cancelled: false };
    },
    async prepare() {
      const selected = await dialog.showOpenDialog(window(), { title: copy("导入 MStruct档案库 ZIP v2", "Import Archive ZIP v2"), properties: ["openFile"], filters: [{ name: "ZIP", extensions: ["zip"] }] });
      if (selected.canceled) return { cancelled: true };
      const info = await fs.stat(selected.filePaths[0]); if (info.size > MAX_BYTES) throw Error("library-size");
      const bundle = readPublicZip(await fs.readFile(selected.filePaths[0])), token = randomUUID();
      pending.clear(); pending.set(token, { bundle });
      return { token, sha256: bundle.sha256, catalog: bundle.catalog, manifest: bundle.manifest,
        texts: Object.fromEntries([...bundle.files].map(([key, data]) => [key, data.toString("utf8")])) };
    },
    async plan(token) {
      const item = pending.get(token); if (!item) throw Error("library-stale");
      item.plan = await (await requireStore()).planImport(item.bundle);
      return item.plan;
    },
    async apply(value) {
      const item = pending.get(value.token); if (!item?.plan) throw Error("library-stale");
      const result = await (await requireStore()).applyImport(item.bundle, item.plan, value.decisions);
      pending.clear(); setPath(null); return result;
    },
    async cancel() { pending.clear(); },
  };
  const guarded = new Set(["choose", "leave", "create", "rename", "trash", "prepare", "apply"]);
  for (const [name, action] of Object.entries(operations)) ipcMain.handle(`mstruct-library:${name}`, async (event, value) => {
    assertTrustedSender(event);
    // Save-before-leave must finish its own queued save/cache requests before this action queues.
    if (name === "open" && !await confirmDiscard(copy("打开分析", "open analysis"))) return { cancelled: true };
    if (guarded.has(name) && !await guard()) return { cancelled: true };
    const operation = queue.then(() => action(value));
    queue = operation.catch(() => {});
    return operation;
  });
  return {
    active,
    async saveManaged(filePath, text, name, saveAs = false) {
      const operation = queue.then(async () => {
        const library = await active(), relative = library?.relativeOf(filePath);
        if (!relative) return null;
        if (!validName(name)) throw Error("library-name");
        const parent = path.posix.dirname(relative), folder = parent === "." ? "" : parent, next = `${folder ? `${folder}/` : ""}${name}.mstruct`;
        if (saveAs && relative !== next) throw Error("library-name-mismatch");
        if (!await readOptional(filePath)) { await library.createAnalysis(folder, name, text); return safePath(library.root, next); }
        return library.renameFile(relative, next, text);
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
module.exports = { setupLibraryIpc };
