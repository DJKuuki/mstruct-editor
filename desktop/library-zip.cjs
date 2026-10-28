const { inflateRawSync } = require("node:zlib");
const { digest, validPath } = require("./library-paths.cjs");
const MAX_BYTES = 64 * 1024 * 1024;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function readPublicZip(bytes) {
  if (bytes.length > MAX_BYTES || bytes.length < 22) throw Error("library-zip");
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) throw Error("library-zip");
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count > 60000 || centralStart + centralSize !== end) throw Error("library-zip");
  const files = new Map(), normalized = new Set();
  let cursor = centralStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error("library-zip");
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const packed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), length = bytes.readUInt16LE(cursor + 28);
    const offset = bytes.readUInt32LE(cursor + 42), attrs = bytes.readUInt32LE(cursor + 38);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + length), name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    cursor += 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (cursor > end || !validPath(name) || normalized.has(name.normalize("NFKC").toLowerCase()) || flags & ~0x0808 || ![0, 8].includes(method)
      || (attrs >>> 16 & 0xf000) === 0xa000) throw Error("library-zip");
    normalized.add(name.normalize("NFKC").toLowerCase());
    total += size;
    if (total > MAX_BYTES || offset + 30 > centralStart || bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 8) !== method || bytes.readUInt16LE(offset + 6) !== flags) throw Error("library-zip");
    const localLength = bytes.readUInt16LE(offset + 26), dataStart = offset + 30 + localLength + bytes.readUInt16LE(offset + 28);
    if (!bytes.subarray(offset + 30, offset + 30 + localLength).equals(nameBytes) || dataStart + packed > centralStart) throw Error("library-zip");
    const compressed = bytes.subarray(dataStart, dataStart + packed), data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_BYTES });
    if (data.length !== size || crc32(data) !== crc) throw Error("library-checksum");
    files.set(name, data);
  }
  if (cursor !== end) throw Error("library-zip");
  return { ...validatePublicFiles(files), sha256: digest(bytes) };
}
function validatePublicFiles(files, { allowModifiedDocuments = false } = {}) {
  const json = name => JSON.parse(files.get(name)?.toString("utf8") ?? "null");
  const manifest = json("manifest.json"), catalog = json("catalog.json");
  if (manifest?.kind !== "mstruct-archive-public-download" || manifest.version !== 2 || manifest.catalog !== "catalog.json"
    || !Number.isFinite(Date.parse(manifest.generatedAt)) || !Array.isArray(manifest.files) || manifest.files.length > 60000) throw Error("library-format");
  const listed = new Set(), normalized = new Set(), modified = [];
  for (const entry of manifest.files) {
    const data = files.get(entry.path);
    if (!validPath(entry.path) || normalized.has(entry.path.normalize("NFKC").toLowerCase()) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_BYTES) throw Error("library-checksum");
    if (!data || entry.bytes !== data.length || digest(data) !== entry.sha256) {
      if (allowModifiedDocuments && /\.(mstruct|mstructtime)$/.test(entry.path)) modified.push(entry.path);
      else throw Error("library-checksum");
    }
    listed.add(entry.path);
    normalized.add(entry.path.normalize("NFKC").toLowerCase());
  }
  for (const name of files.keys()) if (!["manifest.json", "README.txt"].includes(name) && !listed.has(name)) throw Error("library-unlisted");
  if (!listed.has("catalog.json") || catalog?.kind !== "mstruct-archive-catalog" || catalog.version !== 1 || catalog.generatedAt !== manifest.generatedAt
    || !Array.isArray(catalog.analyses) || catalog.analyses.length > 60000) throw Error("library-catalog");
  const ids = new Set(), referenced = new Set(), timelineSources = new Map();
  for (const item of catalog.analyses) {
    if (!Number.isSafeInteger(item.analysisId) || item.analysisId < 1 || ids.has(item.analysisId) || !/^ms[1-9]\d*$/.test(item.songId)
      || !["available", "revision_required", "hidden", "deleted", "unavailable"].includes(item.status) || !Array.isArray(item.timelines) || item.timelines.length > 1000) throw Error("library-catalog");
    ids.add(item.analysisId);
    if (item.status === "available") {
      if (!files.has(item.path) || !new RegExp(`^${item.songId} - [^/]+/[^/]+\\.mstruct$`).test(item.path) || referenced.has(item.path)) throw Error("library-catalog");
      referenced.add(item.path);
    } else if (item.path !== null) throw Error("library-catalog");
    const timelines = new Set();
    for (const timeline of item.timelines) {
      if (!Number.isSafeInteger(timeline.timelineId) || timeline.timelineId < 1 || timelines.has(timeline.timelineId)) throw Error("library-catalog");
      timelines.add(timeline.timelineId);
      const previous = timelineSources.get(timeline.timelineId);
      if (previous && (previous.songId !== item.songId || previous.path !== timeline.path)) throw Error("library-catalog");
      timelineSources.set(timeline.timelineId, { songId: item.songId, path: timeline.path });
      if (timeline.path !== null) {
        if (item.status !== "available" || timeline.path !== `${item.path.split("/")[0]}/timeline-${timeline.timelineId}.mstructtime` || !files.has(timeline.path)) throw Error("library-catalog");
        referenced.add(timeline.path);
      }
    }
  }
  for (const name of files.keys()) if (!referenced.has(name) && !["manifest.json", "catalog.json", "README.txt"].includes(name) && !/^rules\/[a-f0-9]{64}\/[^/]+$/.test(name)) throw Error("library-unlisted");
  return { manifest, catalog, files, modified };
}
module.exports = { readPublicZip, validatePublicFiles, crc32, MAX_BYTES };
