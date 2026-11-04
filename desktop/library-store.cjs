const fs = require("node:fs/promises");
const path = require("node:path");
const { INTERNAL, digest, validName, safePath, readOptional, assertVacant } = require("./library-paths.cjs");
const { atomicWrite, transact, recover } = require("./library-transaction.cjs");
const { migrationWrites } = require("./library-migration.cjs");

const STATE = `${INTERNAL}/state.json`, CACHE = `${INTERNAL}/index.json`;
const emptyState = () => ({ version: 1, sources: {}, audio: {}, snapshot: null });
const fileId = info => `${info.dev}:${info.ino}:${info.birthtimeMs}`;
function createLibraryStore(root) {
  let state, files = [], folders = [];
  async function load() {
    if ((await fs.lstat(root)).isSymbolicLink()) throw Error("library-symlink");
    await safePath(root, STATE, { internal: true });
    await fs.mkdir(path.join(root, INTERNAL), { recursive: true });
    await recover(root);
    const data = await readOptional(path.join(root, STATE));
    state = data ? JSON.parse(data) : emptyState();
    if (state.version !== 1 || !state.sources || !state.audio) throw Error("library-state");
  }
  async function saveState() { await atomicWrite(path.join(root, STATE), JSON.stringify(state)); }
  async function stateAfterWrites() {
    for (const source of Object.values(state.sources)) if (source.localPath && !source.deleted) {
      try { source.fileId = fileId(await fs.stat(await safePath(root, source.localPath))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return JSON.stringify(state);
  }
  async function scan() {
    await load(); files = []; folders = [];
    async function walk(directory = "") {
      const entries = await fs.readdir(directory ? await safePath(root, directory) : root, { withFileTypes: true });
      for (const item of entries) {
        if ([INTERNAL, ".rules"].includes(item.name.toLowerCase()) || (!directory && item.name.toLowerCase() === "rules")) continue;
        const relative = directory ? `${directory}/${item.name}` : item.name;
        if (!validName(item.name) || item.isSymbolicLink()) continue;
        if (item.isDirectory()) { folders.push(relative); await walk(relative); }
        else if (item.isFile() && /\.(mstruct|mstructtime)$/i.test(item.name)) {
          if (files.length >= 60000) throw Error("library-size");
          const target = await safePath(root, relative), info = await fs.stat(target);
          if (info.size > 16 * 1024 * 1024) { files.push({ path: relative, error: "library-size" }); continue; }
          const data = await fs.readFile(target);
          files.push({ path: relative, hash: digest(data), fileId: fileId(info), text: data.toString("utf8") });
        }
      }
    }
    await walk();
    for (const source of Object.values(state.sources)) {
      if (!source.localPath) continue;
      const found = files.find(file => file.path === source.localPath) ?? files.find(file => source.fileId && file.fileId === source.fileId);
      if (found) { source.localPath = found.path; source.fileId = found.fileId; source.lastLocalHash = found.hash; source.deleted = false; }
      else source.deleted = true;
    }
    await saveState();
    return { root, folders, files, state: structuredClone(state), cache: await readCache() };
  }
  async function readCache() { try { return JSON.parse((await fs.readFile(path.join(root, CACHE))).toString("utf8")); } catch { return null; } }
  async function writeCache(cache) { await atomicWrite(path.join(root, CACHE), JSON.stringify(cache)); }
  function sourceFor(relative) { return Object.values(state.sources).find(source => source.localPath === relative); }
  function relativeOf(absolute) { const value = path.relative(root, absolute).split(path.sep).join("/"); return value && !value.startsWith("../") && !path.isAbsolute(value) ? value : null; }
  async function renameFile(relative, nextRelative, text) {
    await load();
    const oldPath = await safePath(root, relative), nextPath = await assertVacant(root, nextRelative, oldPath);
    const old = await fs.readFile(oldPath), changes = [];
    const caseOnly = relative.toLowerCase() === nextRelative.toLowerCase() && relative !== nextRelative;
    changes.push(caseOnly ? { path: relative, data: text ?? old, expected: digest(old), renameTo: nextRelative }
      : { path: nextRelative, data: text ?? old, expected: relative === nextRelative ? digest(old) : null });
    if (relative !== nextRelative && !caseOnly) changes.push({ path: relative, data: null, expected: digest(old) });
    const oldStem = relative.replace(/\.[^.]+$/, ""), nextStem = nextRelative.replace(/\.[^.]+$/, "");
    if (relative !== nextRelative) for (const extension of [".mp4", ".wav", ".mp3"]) {
      const audio = await readOptional(await safePath(root, `${oldStem}${extension}`));
      if (!audio) continue;
      await assertVacant(root, `${nextStem}${extension}`, caseOnly ? await safePath(root, `${oldStem}${extension}`) : null);
      if (caseOnly) changes.push({ path: `${oldStem}${extension}`, data: audio, expected: digest(audio), renameTo: `${nextStem}${extension}` });
      else changes.push({ path: `${nextStem}${extension}`, data: audio, expected: null }, { path: `${oldStem}${extension}`, data: null, expected: digest(audio) });
    }
    for (const source of Object.values(state.sources)) if (source.localPath === relative) { source.localPath = nextRelative; source.lastLocalHash = digest(text ?? old); source.fileId = null; }
    for (const [key, value] of Object.entries(state.audio)) if (key === relative || key.startsWith(`${relative}::`)) {
      const newKey = key.replace(relative, nextRelative);
      state.audio[newKey] = value; delete state.audio[key];
    }
    changes.push({ path: STATE, data: stateAfterWrites });
    await transact(root, changes);
    return nextPath;
  }
  async function createFolder(parent, name) {
    if (!validName(name) || (!parent && name.toLowerCase() === "rules")) throw Error("library-name");
    const relative = parent ? `${parent}/${name}` : name;
    await fs.mkdir(await assertVacant(root, relative));
    return relative;
  }
  async function createAnalysis(folder, name, text) {
    if (!validName(name)) throw Error("library-name");
    const relative = folder ? `${folder}/${name}.mstruct` : `${name}.mstruct`;
    await assertVacant(root, relative);
    await transact(root, [{ path: relative, data: text, expected: null }]);
    return relative;
  }
  async function renameFolder(relative, name) {
    if (!validName(name)) throw Error("library-name");
    await load();
    const parent = path.posix.dirname(relative), next = parent === "." ? name : `${parent}/${name}`;
    const original = await safePath(root, relative), target = await assertVacant(root, next, original);
    // Only directories explicitly chosen by the user are renamed; symlinks are rejected.
    await fs.rename(original, target);
    const relocate = value => value === relative || value.startsWith(`${relative}/`) ? next + value.slice(relative.length) : value;
    for (const source of Object.values(state.sources)) if (source.localPath) source.localPath = relocate(source.localPath);
    state.audio = Object.fromEntries(Object.entries(state.audio).map(([key, value]) => [relocate(key), value]));
    try { await saveState(); } catch (error) { await fs.rename(target, original); throw error; }
    return next;
  }
  async function remove(relative, trash) {
    await load();
    const target = await safePath(root, relative);
    await trash(target);
    for (const source of Object.values(state.sources)) if (source.localPath === relative || source.localPath?.startsWith(`${relative}/`)) source.deleted = true;
    await saveState();
  }
  async function planImport(bundle) {
    await scan();
    const records = [], byPath = new Map(files.map(file => [file.path, file]));
    for (const analysis of bundle.catalog.analyses) {
      const entries = [{ key: `a:${analysis.analysisId}`, remotePath: analysis.path }, ...analysis.timelines.map(timeline => ({ key: `t:${timeline.timelineId}`, remotePath: timeline.path }))];
      for (const entry of entries) {
        if (records.some(record => record.key === entry.key)) continue;
        const previous = state.sources[entry.key];
        if (previous && previous.songId !== analysis.songId) throw Error("library-source-identity");
        const remote = entry.remotePath ? bundle.files.get(entry.remotePath) : null, remoteHash = remote ? digest(remote) : null;
        let localPath = previous?.localPath ?? entry.remotePath;
        if (previous?.localPath && entry.remotePath) {
          const localFolder = path.posix.dirname(previous.localPath), oldFolder = previous.remotePath ? path.posix.dirname(previous.remotePath) : null;
          localPath = `${localFolder !== oldFolder ? localFolder : path.posix.dirname(entry.remotePath)}/${path.posix.basename(entry.remotePath)}`;
        }
        // A moved local folder remains the user's chosen folder, including new timelines.
        if (!previous && entry.remotePath) {
          const sibling = Object.values(state.sources).find(source => source.songId === analysis.songId && source.localPath && source.remotePath && !source.deleted);
          if (sibling && path.posix.dirname(sibling.localPath) !== path.posix.dirname(sibling.remotePath)) localPath = `${path.posix.dirname(sibling.localPath)}/${path.posix.basename(entry.remotePath)}`;
        }
        const local = byPath.get(previous?.localPath ?? localPath), target = byPath.get(localPath);
        const occupied = localPath ? await readOptional(await safePath(root, localPath)) : null;
        const localNameChanged = previous?.localPath && previous.remotePath && path.posix.basename(previous.localPath) !== path.posix.basename(previous.remotePath);
        let action = "keep", conflict = false;
        if (remote) {
          if (local?.hash === remoteHash && (!previous || previous.localPath === localPath)) action = "same";
          else if (previous?.baseline === remoteHash && (!previous || previous.remotePath === entry.remotePath || previous.deleted || local?.hash !== previous.baseline)) action = "keep";
          else if (previous && !localNameChanged && local?.hash === previous.baseline && (!occupied || localPath === previous.localPath)) action = "write";
          else if (!previous && !occupied) action = "write";
          else { action = "conflict"; conflict = true; }
          if (occupied && localPath !== previous?.localPath && (target?.hash ?? digest(occupied)) !== remoteHash) { action = "conflict"; conflict = true; }
        }
        records.push({ ...entry, songId: analysis.songId, status: analysis.status, previous: structuredClone(previous), localPath, remoteHash,
          localHash: local?.hash ?? null, targetHash: occupied ? digest(occupied) : null, action, conflict,
          localText: conflict ? local?.text ?? "" : undefined, remoteText: conflict ? remote?.toString("utf8") : undefined });
      }
    }
    return { records, snapshotHash: digest(await fs.readFile(path.join(root, STATE))), root, sha256: bundle.sha256, generatedAt: bundle.catalog.generatedAt };
  }
  async function applyImport(bundle, plan, decisions = {}) {
    await load();
    if (plan.root !== root || digest(await fs.readFile(path.join(root, STATE))) !== plan.snapshotHash) throw Error("library-stale");
    const conflicts = new Set(plan.records.filter(item => item.conflict).map(item => item.songId));
    for (const songId of conflicts) if (!["local", "remote"].includes(decisions[songId])) throw Error("library-decision");
    const changes = new Map();
    const put = change => {
      const existing = changes.get(change.path.toLowerCase());
      if (existing && (existing.data === null || change.data === null || digest(existing.data) !== digest(change.data))) throw Error("library-duplicate-target");
      changes.set(change.path.toLowerCase(), change);
    };
    for (const record of plan.records) {
      const previous = record.previous;
      const useRemote = record.remoteHash && (record.action === "write" || (conflicts.has(record.songId) && decisions[record.songId] === "remote"));
      let localPath = previous?.localPath ?? record.localPath;
      if (useRemote) {
        await assertVacant(root, record.localPath, await safePath(root, record.localPath));
        // A target belonging to another source is never overwritten by a conflict choice.
        if (Object.entries(state.sources).some(([key, source]) => key !== record.key && source.localPath?.toLowerCase() === record.localPath.toLowerCase())) throw Error("library-exists");
        put({ path: record.localPath, data: bundle.files.get(record.remotePath), expected: record.targetHash });
        if (previous?.localPath && previous.localPath !== record.localPath && record.localHash) {
          put({ path: previous.localPath, data: null, expected: record.localHash });
          // Keep user audio byte-for-byte at its original path and remember that association.
          const oldStem = previous.localPath.replace(/\.[^.]+$/, "");
          const candidates = [];
          for (const extension of [".mp4", ".wav", ".mp3"]) if (await readOptional(await safePath(root, `${oldStem}${extension}`))) candidates.push(path.join(root, ...`${oldStem}${extension}`.split("/")));
          if (candidates.length && !state.audio[record.localPath]) state.audio[record.localPath] = candidates[0];
        }
        localPath = record.localPath;
      }
      state.sources[record.key] = { songId: record.songId, status: record.status, remotePath: record.remotePath, baseline: record.remoteHash ?? previous?.baseline ?? null,
        localPath, deleted: useRemote ? false : previous?.deleted ?? !record.localHash, fileId: useRemote ? null : previous?.fileId,
        lastLocalHash: useRemote ? record.remoteHash : record.localHash, checkedAt: new Date().toISOString(), generatedAt: bundle.catalog.generatedAt };
    }
    for (const [relative, data] of bundle.files) if (relative.startsWith("rules/")) {
      const target = `.${relative}`, old = await readOptional(await safePath(root, target, { internal: true }));
      if (old && digest(old) !== digest(data)) throw Error("library-rules-immutable");
      if (!old) put({ path: target, data, expected: null });
    }
    state.snapshot = { sha256: bundle.sha256, generatedAt: bundle.catalog.generatedAt, checkedAt: new Date().toISOString() };
    put({ path: STATE, data: stateAfterWrites, expected: plan.snapshotHash });
    await transact(root, [...changes.values()]);
    for (const record of plan.records) if (record.previous?.localPath && record.previous.localPath !== state.sources[record.key].localPath) {
      const oldFolder = path.posix.dirname(record.previous.localPath);
      if (oldFolder !== ".") await fs.rmdir(await safePath(root, oldFolder)).catch(error => { if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error; });
    }
    return { written: [...changes.values()].filter(change => /\.(mstruct|mstructtime)$/.test(change.path) && change.data !== null).length, snapshot: state.snapshot };
  }
  async function rules() {
    await load(); const result = [];
    const seen = new Set();
    for (const prefix of [".rules", `${INTERNAL}/rules`, "rules"]) {
      const directory = await safePath(root, `${prefix}/placeholder`, { internal: true });
      let names = []; try { names = await fs.readdir(path.dirname(directory)); } catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      if (seen.has(name)) continue;
      const folder = await safePath(root, `${prefix}/${name}`, { internal: true }), profile = { files: {} };
      profile.manifest = JSON.parse(await fs.readFile(path.join(folder, "manifest.json"), "utf8"));
      for (const file of await fs.readdir(folder)) if (file !== "manifest.json") profile.files[file] = await fs.readFile(await safePath(root, `${prefix}/${name}/${file}`, { internal: true }), "utf8");
      result.push(profile); seen.add(name);
      }
    }
    return result;
  }
  async function adoptExtracted(bundle) {
    await scan();
    if (state.snapshot || Object.keys(state.sources).length) return false;
    const descriptors = new Map(bundle.manifest.files.map(entry => [entry.path, entry])), changes = [];
    for (const analysis of bundle.catalog.analyses) {
      const records = [{ key: `a:${analysis.analysisId}`, path: analysis.path }, ...analysis.timelines.map(item => ({ key: `t:${item.timelineId}`, path: item.path }))];
      for (const item of records) {
        const local = files.find(file => file.path === item.path);
        state.sources[item.key] = { songId: analysis.songId, status: analysis.status, remotePath: item.path, localPath: item.path,
          baseline: descriptors.get(item.path)?.sha256 ?? null, lastLocalHash: local?.hash ?? null, fileId: local?.fileId ?? null,
          deleted: !local, generatedAt: bundle.catalog.generatedAt, checkedAt: new Date().toISOString() };
      }
    }
    for (const [relative, data] of bundle.files) if (relative.startsWith("rules/")) {
      const target = `.${relative}`, old = await readOptional(await safePath(root, target, { internal: true }));
      if (old && digest(old) !== digest(data)) throw Error("library-rules-immutable");
      if (!old) changes.push({ path: target, data, expected: null });
      if (bundle.locations.get(relative) === relative) changes.push({ path: relative, data: null, expected: digest(data) });
    }
    state.snapshot = { sha256: bundle.sha256, extracted: true, generatedAt: bundle.catalog.generatedAt, checkedAt: new Date().toISOString() };
    changes.push({ path: STATE, data: stateAfterWrites });
    await transact(root, changes);
    const directories = new Set([...bundle.locations.values()].filter(value => value.startsWith("rules/")).map(value => path.posix.dirname(value)));
    for (const directory of [...directories, "rules"]) await fs.rmdir(await safePath(root, directory)).catch(() => {});
    return true;
  }
  async function migrate(payload) {
    await load();
    const { writes, backup } = await migrationWrites(root, payload);
    const stateBytes = await readOptional(path.join(root, STATE));
    writes.push({ path: `${backup}/state.json`, data: stateBytes ?? JSON.stringify(state), expected: null });
    for (const change of payload.changes) {
      const source = sourceFor(change.path);
      if (source) source.lastLocalHash = digest(change.text);
    }
    writes.push({ path: STATE, data: stateAfterWrites, expected: stateBytes ? digest(stateBytes) : null });
    writes.push({ path: CACHE, data: null });
    await transact(root, writes);
    return { written: payload.changes.length, backup: path.join(root, backup) };
  }
  return { root, scan, load, rules, writeCache, relativeOf, sourceFor, renameFile, renameFolder, createFolder, createAnalysis, remove, planImport, applyImport, adoptExtracted, migrate,
    async audioState() { await load(); return state.audio; },
    async rememberAudio(key, value) { await load(); state.audio[key] = value; await saveState(); },
  };
}
module.exports = { createLibraryStore };
