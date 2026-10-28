const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { INTERNAL, digest, safePath, readOptional } = require("./library-paths.cjs");

async function cleanBackups(root, entries) {
  for (const entry of entries) if (entry.backup) {
    const backup = await safePath(root, entry.backup, { internal: true });
    await fs.unlink(backup).catch(error => { if (error.code !== "ENOENT") throw error; });
    await fs.rmdir(path.dirname(backup)).catch(error => { if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error; });
  }
}

async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, data, { flag: "wx" }); await fs.rename(temporary, file); }
  finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
async function recover(root) {
  const journalPath = path.join(root, INTERNAL, "journal.json"), bytes = await readOptional(journalPath);
  if (!bytes) return;
  const journal = JSON.parse(bytes);
  if (journal.version !== 1 || !Array.isArray(journal.entries)) throw Error("library-journal");
  // Rollback is idempotent. Recovery never depends on the rebuildable search cache.
  for (const entry of [...journal.entries].reverse()) {
    const target = await safePath(root, entry.path, { internal: true });
    if (entry.renameTo) {
      const renamed = await safePath(root, entry.renameTo, { internal: true });
      if (await readOptional(renamed)) await fs.rename(renamed, target);
    }
    if (entry.backup) {
      const backup = await safePath(root, entry.backup, { internal: true });
      const data = await fs.readFile(backup);
      if (digest(data) !== entry.hash) throw Error("library-journal");
      await atomicWrite(target, data);
    } else await fs.unlink(target).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  await fs.unlink(journalPath);
  await cleanBackups(root, journal.entries).catch(() => {});
}
async function transact(root, changes, { failAfter = -1 } = {}) {
  await recover(root);
  const id = randomUUID(), entries = [], seen = new Set();
  for (const change of changes) {
    if (seen.has(change.path.toLowerCase())) throw Error("library-duplicate-target");
    seen.add(change.path.toLowerCase());
    const file = await safePath(root, change.path, { internal: true }), old = await readOptional(file);
    if (change.expected !== undefined && (old ? digest(old) : null) !== change.expected) throw Error("library-stale");
    const backup = old ? `${INTERNAL}/recovery/${id}/${entries.length}.bak` : null;
    if (backup) await atomicWrite(await safePath(root, backup, { internal: true }), old);
    if (change.renameTo) await safePath(root, change.renameTo, { internal: true });
    entries.push({ path: change.path, backup, hash: old ? digest(old) : null, renameTo: change.renameTo });
  }
  const journal = path.join(root, INTERNAL, "journal.json");
  await atomicWrite(journal, JSON.stringify({ version: 1, entries }));
  try {
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i], file = await safePath(root, change.path, { internal: true });
      if (change.data === null) await fs.unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
      else await atomicWrite(file, typeof change.data === "function" ? await change.data() : change.data);
      if (change.renameTo) await fs.rename(file, await safePath(root, change.renameTo, { internal: true }));
      if (i === failAfter) throw Error("library-simulated-interruption");
    }
    await fs.unlink(journal);
    await cleanBackups(root, entries).catch(() => {});
  } catch (error) { await recover(root); throw error; }
}
module.exports = { atomicWrite, transact, recover };
