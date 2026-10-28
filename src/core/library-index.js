import { parseMstructDocument, serializeMstructDocument } from "./mstruct-document.js";
import { compileProfileDocument } from "./profile-document.js";
import { readProfileIdentity } from "./profile-schema.js";
import { verifyMstructProfile, sha256, canonicalJson } from "./profile.js";
import { createProfileSearchVocabulary, parseProfileSearchQuery } from "./profile-search.js";
import { matchMstructSearchQuery } from "./mstruct-search-match.js";
import { MSTRUCT_SEARCH_INDEX_FORMAT_VERSION } from "./mstruct-search-events.js";
import { buildAnalysisSearchIndex } from "./mstruct-search-index-data.js";
import { parseMstructtimeDocument } from "./mstructtime-document.js";
import { compareMstructProfiles } from "./profile-diff.js";

export const LIBRARY_INDEX_VERSION = 2;
export function validateLibraryName(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 172 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value)
    || /[. ]$/.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) || [".", "..", ".mstruct-library", ".rules"].includes(value.toLowerCase())) throw Error("library-name");
  return value;
}
export function renameLibraryAnalysis(source, name) {
  validateLibraryName(name);
  const document = parseMstructDocument(source);
  if (!document.ok || document.legacy) throw Error("library-parse");
  return serializeMstructDocument({ ...document, metadata: { ...document.metadata, versionName: name } });
}
export async function validateLibraryPackage(texts, catalog, { modified = [] } = {}) {
  const changed = new Set(modified);
  const profiles = new Map();
  for (const [name, text] of Object.entries(texts)) if (/^rules\/[a-f0-9]{64}\/manifest.json$/.test(name)) {
    const prefix = name.slice(0, -"manifest.json".length), manifest = JSON.parse(text);
    const files = Object.fromEntries(Object.entries(texts).filter(([key]) => key.startsWith(prefix) && key !== name).map(([key, value]) => [key.slice(prefix.length), value]));
    const profile = await verifyMstructProfile({ manifest, files });
    if (prefix !== `rules/${profile.manifest.bundleHash.slice(7)}/`) throw Error("library-rules");
    profiles.set(profile.manifest.bundleHash, profile);
  }
  for (const entry of catalog.analyses) if (entry.path) {
    if (changed.has(entry.path)) continue;
    const document = parseMstructDocument(texts[entry.path]);
    if (!document.ok || document.legacy) throw Error("library-parse");
    const identity = readProfileIdentity(document.metadata), profile = profiles.get(identity?.bundleHash);
    if (!profile || !compileProfileDocument(document, profile).ok) throw Error("library-rules");
    if (entry.path.split("/").at(-1) !== `${validateLibraryName(document.metadata.versionName)}.mstruct`) throw Error("library-name-mismatch");
    const expected = new Set(document.metadata.mstructtimeFiles);
    const actual = entry.timelines.filter(timeline => timeline.path).map(timeline => timeline.path.split("/").at(-1));
    if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw Error("library-timeline");
    for (const timeline of entry.timelines) if (timeline.path && !changed.has(timeline.path) && !parseMstructtimeDocument(texts[timeline.path]).ok) throw Error("library-timeline");
  }
  return [...profiles.values()];
}
export async function buildLibraryIndex({ files, sources = {}, cached, resolveProfile, onProgress = () => {} }) {
  const entries = [], builds = new Map(), candidates = files.filter(file => /\.mstruct$/i.test(file.path));
  const previous = cached?.version === LIBRARY_INDEX_VERSION && cached?.formatVersion === MSTRUCT_SEARCH_INDEX_FORMAT_VERSION ? new Map(cached.entries.map(entry => [entry.path, entry])) : new Map();
  for (const [i, file] of candidates.entries()) {
    onProgress(i, candidates.length);
    const entry = { path: file.path, hash: file.hash, status: "pending" };
    const origin = Object.entries(sources).find(([key, value]) => key.startsWith("a:") && value.localPath === file.path && !value.deleted);
    if (origin) entry.origin = { id: origin[0], ...origin[1] };
    try {
      if (file.error) throw Error(file.error);
      const document = parseMstructDocument(file.text);
      if (!document.ok || document.legacy) throw Error("library-parse");
      const metadata = document.metadata;
      entry.metadata = metadata;
      entry.nameMismatch = file.path.split("/").at(-1) !== `${metadata.versionName}.mstruct`;
      const identity = readProfileIdentity(metadata);
      if (!identity) throw Error("profile-assignment-required");
      const candidateProfile = await resolveProfile(identity);
      const profile = await verifyMstructProfile(candidateProfile, { ...identity, bundleHash: candidateProfile.manifest.bundleHash });
      const key = `${profile.manifest.profileId}:${profile.manifest.bundleHash}`;
      entry.usedProfileHash = profile.manifest.bundleHash;
      const installed = builds.get(key);
      if (installed) entry.family = installed.semanticFamily;
      else {
        const compatible = [];
        for (const build of builds.values()) if (build.profile.manifest.profileId === identity.profileId
          && (await compareMstructProfiles(build.profile, profile)).semanticCompatible) compatible.push(build);
        // Only combine a family when every member agrees; same-name incompatible rules compile separately.
        const candidate = compatible.find(build => [...builds.values()].filter(other => other.semanticFamily === build.semanticFamily).every(other => compatible.includes(other)));
        entry.family = candidate?.semanticFamily ?? key;
      }
      builds.set(key, { profile, semanticFamily: entry.family });
      const configHash = await sha256(canonicalJson(profile.files));
      const old = previous.get(file.path);
      if (old?.hash === file.hash && old.configHash === configHash && old.status === "ready") {
        entries.push({ ...old, origin: entry.origin, family: entry.family, nameMismatch: entry.nameMismatch }); continue;
      }
      const result = compileProfileDocument({ ...document, metadata: { ...metadata, mstructProfileHash: profile.manifest.bundleHash } }, profile);
      if (!result.ok) { entry.diagnostics = result.errors; throw Error("library-parse"); }
      const index = await buildAnalysisSearchIndex({ analysisId: i, songId: 0, documentText: file.text, parsed: result, globalTags: result.globalTags, configHash });
      Object.assign(entry, { configHash, projection: JSON.parse(index.eventStreamJson), status: "ready" });
    } catch (error) { entry.status = "error"; entry.error = error.code ?? error.message; }
    entries.push(entry);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  onProgress(candidates.length, candidates.length);
  return { version: LIBRARY_INDEX_VERSION, formatVersion: MSTRUCT_SEARCH_INDEX_FORMAT_VERSION, entries, families: createProfileSearchVocabulary([...builds.values()]) };
}
export function searchLibrary(index, { song = "", technique = "" } = {}) {
  const needle = song.normalize("NFKC").toLocaleLowerCase().trim();
  const parsed = technique.trim() ? parseProfileSearchQuery(technique, index.families) : null;
  if (parsed && !parsed.ok) return { ok: false, errors: parsed.errors, entries: [] };
  const entries = [];
  for (const entry of index.entries) {
    const metadata = entry.metadata ?? {};
    if (needle && ![metadata.songName, metadata.songNameRomanized, entry.origin?.songId].some(value => String(value ?? "").normalize("NFKC").toLocaleLowerCase().includes(needle))) continue;
    if (parsed) {
      if (entry.status !== "ready") continue;
      const query = parsed.queries.find(item => item.semanticFamily === entry.family)?.query;
      if (!query) continue;
      const matched = matchMstructSearchQuery(query, entry.projection);
      if (matched.ok === false) return { ok: false, errors: matched.errors, entries: [] };
      if (!matched.windows.length) continue;
      entries.push({ ...entry, matches: matched.windows });
    } else entries.push(entry);
  }
  return { ok: true, errors: [], entries, incomplete: index.entries.filter(entry => entry.status !== "ready").length };
}
