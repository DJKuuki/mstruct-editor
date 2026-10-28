const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { atomicWrite } = require("./library-transaction.cjs");
const { readOptional } = require("./library-paths.cjs");

function setupDesktopAudio({ ipcMain, dialog, userData, window, locale, assertTrustedSender, currentPath, library }) {
  const storePath = path.join(userData, "audio-associations.json"), resources = new Map();
  const copy = (zh, en) => locale() === "en" ? en : zh;
  async function associations() { const bytes = await readOptional(storePath); return bytes ? JSON.parse(bytes) : {}; }
  function target(value) {
    const analysis = currentPath(); if (!analysis) return null;
    if (value?.stable) return analysis;
    const name = value?.timeline;
    if (typeof name !== "string" || path.basename(name) !== name || !/\.mstructtime$/i.test(name)) return null;
    return path.join(path.dirname(analysis), name);
  }
  async function remember(key, value) { const values = await associations(); values[key] = value; await atomicWrite(storePath, JSON.stringify(values)); }
  async function audioResult(file) {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 512 * 1024 * 1024 || !/\.(mp3|wav)$/i.test(file)) throw Error("library-audio");
    const token = randomUUID(); resources.clear(); resources.set(token, file);
    return { url: `mstruct-app://renderer/__local_audio__/${token}`, name: path.basename(file) };
  }
  async function find(value) {
    const key = target(value); resources.clear(); if (!key) return { missing: true };
    const stem = path.basename(key).replace(/\.[^.]+$/, "").toLowerCase();
    const names = await fs.readdir(path.dirname(key));
    const candidates = names.filter(name => /\.(mp3|wav)$/i.test(name) && name.replace(/\.[^.]+$/, "").toLowerCase() === stem).map(name => path.join(path.dirname(key), name));
    const values = await associations(); let selected = values[key];
    if (candidates.length === 1) selected = candidates[0];
    if (candidates.length > 1 && !candidates.includes(selected)) {
      const result = await dialog.showMessageBox(window(), { message: copy("选择对应的录音", "Choose the recording"), buttons: [...candidates.map(file => path.basename(file)), copy("取消", "Cancel")], cancelId: candidates.length, noLink: true });
      selected = candidates[result.response]; if (selected) await remember(key, selected);
    }
    if (!selected) {
      const active = await library.active(), relative = active?.relativeOf(key);
      if (relative) selected = (await active.audioState())[relative];
    }
    if (!selected) return { missing: true };
    try { return await audioResult(selected); } catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return { missing: true }; throw error; }
  }
  async function choose(value) {
    const key = target(value);
    const selected = await dialog.showOpenDialog(window(), { title: copy("选择音频", "Choose audio"), properties: ["openFile"], filters: [{ name: "MP3 / WAV", extensions: ["mp3", "wav"] }] });
    if (selected.canceled) return { cancelled: true };
    let file = selected.filePaths[0]; await audioResult(file);
    if (!key) return audioResult(file);
    const result = await dialog.showMessageBox(window(), { message: copy("是否复制音频到当前文件旁？", "Copy audio beside the current file?"), detail: copy("复制后使用相同文件名主干；不复制则记住外部路径。", "A copy uses the same filename stem. Keeping the original remembers its external path."),
      buttons: [copy("复制", "Copy"), copy("不复制", "Keep external"), copy("取消", "Cancel")], defaultId: 0, cancelId: 2, noLink: true });
    if (result.response === 2) return { cancelled: true };
    if (result.response === 0) {
      const destination = key.replace(/\.[^.]+$/, "") + path.extname(file).toLowerCase();
      if (destination.toLowerCase() !== file.toLowerCase()) {
        if (await readOptional(destination)) {
          const overwrite = await dialog.showMessageBox(window(), { type: "warning", message: copy("同名音频已存在，是否覆盖？", "Audio already exists. Overwrite?"), detail: path.basename(destination), buttons: [copy("覆盖", "Overwrite"), copy("取消", "Cancel")], defaultId: 1, cancelId: 1, noLink: true });
          if (overwrite.response !== 0) return { cancelled: true };
        }
        await atomicWrite(destination, await fs.readFile(file));
      }
      file = destination;
    }
    await remember(key, file); return audioResult(file);
  }
  for (const [name, operation] of Object.entries({ find, choose })) ipcMain.handle(`mstruct-audio:${name}`, (event, value) => { assertTrustedSender(event); return operation(value); });
  return {
    async relocate(original, next) {
      const values = await associations(), updated = {};
      for (const [key, value] of Object.entries(values)) {
        const relocate = item => item === original || item.startsWith(`${original}${path.sep}`) ? next + item.slice(original.length) : item;
        updated[relocate(key)] = relocate(value);
      }
      await atomicWrite(storePath, JSON.stringify(updated));
    },
    async response(token) { const file = resources.get(token); if (!file) return new Response("Not found", { status: 404 }); return new Response(await fs.readFile(file), { headers: { "content-type": /\.wav$/i.test(file) ? "audio/wav" : "audio/mpeg" } }); },
  };
}
module.exports = { setupDesktopAudio };
