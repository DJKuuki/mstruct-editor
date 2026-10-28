const fs = require("node:fs/promises");
const { safePath, readOptional, digest, validPath } = require("./library-paths.cjs");
const { validatePublicFiles, MAX_BYTES } = require("./library-zip.cjs");

/** Register an extracted v2 download without overwriting locally edited or deleted scores. */
async function readExtractedPackage(root) {
  const bytes = await readOptional(await safePath(root, "manifest.json"));
  if (!bytes) return null;
  if (bytes.length > MAX_BYTES) throw Error("library-size");
  const manifest = JSON.parse(bytes);
  if (manifest?.kind !== "mstruct-archive-public-download") return null;
  if (!Array.isArray(manifest.files) || manifest.files.length > 60000) throw Error("library-format");
  const files = new Map([["manifest.json", bytes]]), locations = new Map();
  let total = bytes.length;
  for (const entry of manifest.files) {
    if (!validPath(entry.path)) throw Error("library-path");
    let location = entry.path, data = await readOptional(await safePath(root, location));
    if (!data && location.startsWith("rules/")) {
      location = `.${entry.path}`;
      data = await readOptional(await safePath(root, location, { internal: true }));
    }
    total += data?.length ?? 0; if (total > MAX_BYTES) throw Error("library-size");
    files.set(entry.path, data); locations.set(entry.path, location);
  }
  const bundle = validatePublicFiles(files, { allowModifiedDocuments: true });
  return { ...bundle, locations, sha256: digest(bytes), extracted: true };
}
module.exports = { readExtractedPackage };
