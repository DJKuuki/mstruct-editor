const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");

const INTERNAL = ".mstruct-library";
const digest = value => createHash("sha256").update(value).digest("hex");
function validName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 180 && value === value.trim()
    && !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) && !/[. ]$/.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) && ![".", "..", INTERNAL, ".rules"].includes(value.toLowerCase());
}
function validPath(value) {
  return typeof value === "string" && value.split("/").every(validName) && !value.includes("\\");
}
async function safePath(root, relative, { internal = false } = {}) {
  if (!(internal ? validPath(relative.replace(/^(?:\.mstruct-library|\.rules)\//, "internal/")) : validPath(relative))) throw Error("library-path");
  const target = path.resolve(root, ...relative.split("/"));
  if (path.relative(root, target).startsWith("..") || path.isAbsolute(path.relative(root, target))) throw Error("library-path");
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw Error("library-symlink"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return target;
}
async function readOptional(file) { try { return await fs.readFile(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function assertVacant(root, relative, except = null) {
  const target = await safePath(root, relative), directory = path.dirname(target);
  let names = [];
  try { names = await fs.readdir(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const hit = names.find(name => name.toLowerCase() === path.basename(target).toLowerCase());
  if (hit && path.join(directory, hit) !== except) throw Error("library-exists");
  return target;
}
module.exports = { INTERNAL, digest, validName, validPath, safePath, readOptional, assertVacant };
