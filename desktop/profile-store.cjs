const { createHash, randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, writeFile, readdir } = require("node:fs/promises");
const path = require("node:path");

const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_REGISTRY_URL = "https://mstruct-archive.com/api/mstruct-profiles";
function identityKey(identity) {
  if (typeof identity?.profileId !== "string" || identity.profileId.length > 240
    || !/^sha256:[a-f0-9]{64}$/.test(identity.bundleHash)) throw Error("Invalid profile identity");
  return createHash("sha256").update(JSON.stringify([identity.profileId, identity.bundleHash])).digest("hex");
}
function registryUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw Error("Invalid registry URL");
  url.search = "";
  return url.href;
}

/** Native transport and storage only. Every use is verified by the shared core. */
function createProfileStore(directory, { fetchJson = fetch } = {}) {
  const root = path.resolve(directory, "mstruct-profiles");
  let writes = Promise.resolve();
  async function registry() { return { url: DEFAULT_REGISTRY_URL, index: null, ...await read("registry.json") }; }
  async function read(name) {
    try {
      const bytes = await readFile(path.join(root, name));
      if (bytes.length > MAX_BYTES) throw Error("Profile data exceeds size limit");
      return JSON.parse(bytes.toString("utf8"));
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  function write(name, value) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_BYTES) throw Error("Profile data exceeds size limit");
    const operation = writes.catch(() => {}).then(async () => {
      await mkdir(root, { recursive: true });
      const temporary = path.join(root, `${name}.${randomUUID()}.tmp`);
      await writeFile(temporary, text, "utf8");
      await rename(temporary, path.join(root, name));
    });
    writes = operation;
    return operation;
  }
  async function request(identity) {
    const state = await registry();
    const base = registryUrl(state.url);
    if (!base) throw Error("Profile registry is not configured");
    const url = new URL(base);
    if (identity) { identityKey(identity); url.searchParams.set("profileId", identity.profileId); url.searchParams.set("hash", identity.bundleHash); }
    else url.searchParams.set("index", "1");
    const response = await fetchJson(url.href, { redirect: "error", signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
    if (!response.ok) throw Error(`Registry HTTP ${response.status}`);
    if (!/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) throw Error("Registry did not return JSON");
    let size = 0, chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) { await response.body.cancel?.().catch(() => {}); throw Error("Profile data exceeds size limit"); }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return {
    async state() {
      const savedRegistry = await registry();
      const names = await readdir(root).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
      const installed = [];
      for (const name of names.filter((value) => /^[a-f0-9]{64}\.json$/.test(value))) {
        try { const data = await read(name); if (data?.manifest) installed.push(data.manifest); } catch { /* A damaged bundle remains unavailable to the resolver. */ }
      }
      return { ...savedRegistry, installed };
    },
    get(identity) { return read(`${identityKey(identity)}.json`); },
    put(bundle) { return write(`${identityKey(bundle?.manifest)}.json`, bundle); },
    async configure(value) { const state = await registry(); await write("registry.json", { url: registryUrl(value), index: state.url === registryUrl(value) ? state.index ?? null : null }); },
    fetch: request,
    async saveIndex(index) { const state = await registry(); await write("registry.json", { ...state, index }); },
  };
}
module.exports = { createProfileStore, identityKey, registryUrl, MAX_BYTES, DEFAULT_REGISTRY_URL };
