const { readFileSync, writeFileSync, renameSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

const MAX_RECENT_DOCUMENTS = 10;
const pathKey = value => path.resolve(value).toLocaleLowerCase("en-US");
const documentId = value => createHash("sha256").update(pathKey(value)).digest("hex");

/** File paths stay in the native process and the current OS account's local store. */
function createRecentDocuments(userData) {
  const file = path.join(userData, "recent-documents.json");
  let paths = [];
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (saved.version === 1 && Array.isArray(saved.paths)) {
      const seen = new Set();
      paths = saved.paths.filter(value => {
        if (typeof value !== "string" || !path.isAbsolute(value) || /[\u0000-\u001f]/.test(value)) return false;
        const key = pathKey(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_RECENT_DOCUMENTS);
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Could not read recent documents:", error.message);
  }

  function save(next) {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, paths: next }, null, 2), "utf8");
    renameSync(temporary, file);
    paths = next;
  }

  return {
    list: () => paths.map(filePath => ({ id: documentId(filePath), name: path.basename(filePath), directory: path.dirname(filePath) })),
    get: id => paths.find(filePath => documentId(filePath) === id) ?? null,
    record(filePath) {
      const absolute = path.resolve(filePath);
      save([absolute, ...paths.filter(value => pathKey(value) !== pathKey(absolute))].slice(0, MAX_RECENT_DOCUMENTS));
    },
    remove(id) { save(paths.filter(value => documentId(value) !== id)); },
    clear() { save([]); },
  };
}

module.exports = { createRecentDocuments, MAX_RECENT_DOCUMENTS };
