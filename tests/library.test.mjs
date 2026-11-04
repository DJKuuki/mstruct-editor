import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, rename, unlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { verifyMstructProfile } from "../src/core/profile.js";
import { assignDocumentProfile } from "../src/core/profile-document.js";
import { createEmptyMetadata, parseMstructDocument, serializeMstructDocument } from "../src/core/mstruct-document.js";
import { buildLibraryIndex, searchLibrary, validateLibraryPackage, renameLibraryAnalysis } from "../src/core/library-index.js";
import { serializeSearchVocabulary, deserializeSearchVocabulary } from "../src/core/profile-search.js";
import { createStandaloneProfiles } from "../src/runtime/standalone-profiles.js";
const require = createRequire(import.meta.url);
const { createLibraryStore } = require("../desktop/library-store.cjs");
const { transact, recover } = require("../desktop/library-transaction.cjs");
const { readPublicZip, crc32 } = require("../desktop/library-zip.cjs");
const { digest, safePath } = require("../desktop/library-paths.cjs");
const { setupDesktopAudio } = require("../desktop/library-audio.cjs");
const { readExtractedPackage } = require("../desktop/library-extracted.cjs");
const { setupLibraryIpc } = require("../desktop/library-ipc.cjs");
const profile = await verifyMstructProfile(JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url), "utf8")));

test("save-before-return can complete queued managed saves and state reads before the library transition", { timeout: 2000 }, async () => {
  const { root, store } = await library(), initial = await document("Analysis"), updated = await document("Analysis", "Song", "G");
  await store.createAnalysis("", "Analysis", initial);
  const userData = await mkdtemp(path.join(tmpdir(), "mstruct-library-leave-"));
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ root }));
  const handlers = new Map(), filePath = path.join(root, "Analysis.mstruct");
  let current = filePath, controller;
  controller = setupLibraryIpc({ userData, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, window: () => ({}), locale: () => "zh",
    assertTrustedSender: event => assert.equal(event.trusted, true), currentPath: () => current, setPath: value => { current = value; },
    async confirmDiscard() {
      assert.equal(await controller.saveManaged(filePath, updated, "Analysis"), filePath);
      assert.equal((await handlers.get("mstruct-library:state")({ trusted: true })).root, root);
      return true;
    } });
  assert.deepEqual(await handlers.get("mstruct-library:leave")({ trusted: true }), { cancelled: false });
  assert.equal(current, null); assert.equal(await readFile(filePath, "utf8"), updated);
});
async function document(name = "Analysis", song = "Song", chord = "C") {
  const result = await assignDocumentProfile(serializeMstructDocument({ metadata: { ...createEmptyMetadata(), versionName: name, songName: song, isStableTempo: true }, main: `{BN:1}{TS:4/4}{D:1}{BPM:1/4=120}{TC:C}${chord}|I;` }), profile);
  assert.equal(result.ok, true, JSON.stringify(result.errors)); return result.source;
}
function bundle(text, { status = "available", location = "ms10001 - Song/Analysis.mstruct", timeline = null } = {}) {
  const files = new Map(), generatedAt = new Date().toISOString();
  const catalog = { kind: "mstruct-archive-catalog", version: 1, generatedAt, analyses: [{ analysisId: 7, songId: "ms10001", status, path: status === "available" ? location : null, timelines: timeline ? [{ timelineId: 9, path: `${location.split("/")[0]}/timeline-9.mstructtime` }] : [] }] };
  if (status === "available") files.set(location, Buffer.from(text));
  if (timeline) files.set(catalog.analyses[0].timelines[0].path, Buffer.from(timeline));
  const prefix = `rules/${profile.manifest.bundleHash.slice(7)}/`;
  files.set(`${prefix}manifest.json`, Buffer.from(JSON.stringify(profile.manifest)));
  for (const [name, data] of Object.entries(profile.files)) files.set(prefix + name, Buffer.from(data));
  files.set("catalog.json", Buffer.from(JSON.stringify(catalog)));
  const manifest = { kind: "mstruct-archive-public-download", version: 2, generatedAt, catalog: "catalog.json", files: [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: digest(data) })) };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  return { sha256: digest(JSON.stringify(manifest)), catalog, manifest, files };
}
function zip(files) {
  const chunks = [], central = []; let offset = 0;
  for (const [name, data] of files) {
    const encoded = Buffer.from(name), local = Buffer.alloc(30 + encoded.length), entry = Buffer.alloc(46 + encoded.length), crc = crc32(data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(encoded.length, 26); encoded.copy(local, 30);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(encoded.length, 28); entry.writeUInt32LE(offset, 42); encoded.copy(entry, 46);
    chunks.push(local, data); central.push(entry); offset += local.length + data.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(central.reduce((sum, entry) => sum + entry.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
async function library() { const root = await mkdtemp(path.join(tmpdir(), "mstruct-library-")); return { root, store: createLibraryStore(root) }; }
async function apply(store, value, decisions = {}) { const plan = await store.planImport(value); return store.applyImport(value, plan, decisions); }

test("public ZIP validates CRC, manifest, catalog, complete rules and exact analysis before importing", async () => {
  const value = bundle(await document()), bytes = zip(value.files), read = readPublicZip(bytes);
  assert.equal(read.sha256, digest(bytes));
  assert.equal((await validateLibraryPackage(Object.fromEntries([...read.files].map(([name, data]) => [name, data.toString()])), read.catalog)).length, 1);
  const corrupt = Buffer.from(bytes); corrupt[60] ^= 1; assert.throws(() => readPublicZip(corrupt));
  for (const name of ["../escape.mstruct", "C:/escape.mstruct", ".mstruct-library/state.json", "a/CON.mstruct", "a/Bad .mstruct/"]) {
    const files = new Map(value.files); files.set(name, Buffer.from("x")); assert.throws(() => readPublicZip(zip(files)));
  }
  const duplicate = new Map(value.files); duplicate.set("CATALOG.JSON", Buffer.from("x")); assert.throws(() => readPublicZip(zip(duplicate)));
  const unknown = new Map(value.files); unknown.set("extra.mp3", Buffer.from("x")); assert.throws(() => readPublicZip(zip(unknown)));
});
test("first and repeated import retain stable sources and rules without duplicate or needless writes", async () => {
  const { store } = await library(), value = bundle(await document());
  assert.equal((await apply(store, value)).written, 1);
  assert.equal((await apply(store, value)).written, 0);
  const scanned = await store.scan(); assert.equal(scanned.files.length, 1); assert.equal(Object.keys(scanned.state.sources).length, 1); assert.equal((await store.rules()).length, 1);
});

test("ZIP import accepts equivalent manifest JSON while retaining existing rule bytes", async () => {
  const { root, store } = await library(), value = bundle(await document());
  const ruleManifest = `rules/${profile.manifest.bundleHash.slice(7)}/manifest.json`;
  const localManifest = path.join(root, `.${ruleManifest}`);
  await apply(store, value);
  const original = await readFile(localManifest);
  const formatted = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(profile.manifest).reverse()), null, 2) + "\r\n");
  value.files.set(ruleManifest, formatted);
  Object.assign(value.manifest.files.find(entry => entry.path === ruleManifest), { bytes: formatted.length, sha256: digest(formatted) });
  value.files.set("manifest.json", Buffer.from(JSON.stringify(value.manifest)));
  const incoming = readPublicZip(zip(value.files));
  await validateLibraryPackage(Object.fromEntries([...incoming.files].map(([name, data]) => [name, data.toString()])), incoming.catalog);
  assert.equal((await apply(store, incoming)).written, 0);
  assert.equal((await apply(store, incoming)).written, 0);
  assert.deepEqual(await readFile(localManifest), original);
});

test("rule content differences and malformed manifests still abort the whole import", async () => {
  for (const [name, corrupt] of [
    ["manifest.json", JSON.stringify({ ...profile.manifest, description: "different metadata" })],
    ["manifest.json", "{invalid JSON"],
    ["roman-basic.csv", profile.files["roman-basic.csv"] + "\n"],
  ]) {
    const { root, store } = await library(), initial = bundle(await document());
    await apply(store, initial);
    const location = initial.catalog.analyses[0].path;
    await writeFile(path.join(root, `.rules/${profile.manifest.bundleHash.slice(7)}/${name}`), corrupt);
    const update = bundle(await document("Analysis", "Song", "G")), plan = await store.planImport(update);
    const before = await readFile(path.join(root, ".mstruct-library/state.json"));
    await assert.rejects(store.applyImport(update, plan), /library-rules-immutable/);
    assert.deepEqual(await readFile(path.join(root, location)), initial.files.get(location));
    assert.deepEqual(await readFile(path.join(root, ".mstruct-library/state.json")), before);
  }
});

test("extracted package adoption reuses an equivalent hidden manifest", async () => {
  const { root, store } = await library(), value = bundle(await document());
  for (const [relative, data] of value.files) { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), data); }
  const hidden = path.join(root, `.rules/${profile.manifest.bundleHash.slice(7)}/manifest.json`);
  const formatted = JSON.stringify(profile.manifest, null, 2) + "\n";
  await mkdir(path.dirname(hidden), { recursive: true }); await writeFile(hidden, formatted);
  const extracted = await readExtractedPackage(root);
  assert.equal(await store.adoptExtracted(extracted), true);
  assert.equal(await readFile(hidden, "utf8"), formatted);
  assert.equal((await store.scan()).files.length, 1);
  assert.equal((await apply(store, value)).written, 0);
});
test("three-way conflicts remember keep-local and ask again only for later remote content", async () => {
  const { root, store } = await library(), first = bundle(await document()); await apply(store, first);
  const location = first.catalog.analyses[0].path, local = await document("Analysis", "Song", "F"); await writeFile(path.join(root, location), local);
  const update = bundle(await document("Analysis", "Song", "G"));
  assert.equal((await store.planImport(update)).records[0].conflict, true);
  await apply(store, update, { ms10001: "local" }); assert.equal(await readFile(path.join(root, location), "utf8"), local);
  assert.equal((await store.planImport(update)).records[0].conflict, false);
  assert.equal((await store.planImport(bundle(await document("Analysis", "Song", "Dm")))).records[0].conflict, true);
});
test("local deletion is persistent, changed remote content asks for restore, withdrawal preserves files", async () => {
  const { root, store } = await library(), first = bundle(await document()); await apply(store, first);
  const location = first.catalog.analyses[0].path; await unlink(path.join(root, location)); await apply(store, first);
  await assert.rejects(stat(path.join(root, location)), { code: "ENOENT" });
  const update = bundle(await document("Analysis", "Song", "G")); assert.equal((await store.planImport(update)).records[0].conflict, true);
  await apply(store, update, { ms10001: "remote" });
  await apply(store, bundle("", { status: "hidden" }));
  const scanned = await store.scan(); assert.equal(scanned.files.length, 1); assert.equal(scanned.state.sources["a:7"].status, "hidden");
});
test("external folder move and metadata rename preserve identity; remote rename migrates clean paths", async () => {
  const { root, store } = await library(), first = bundle(await document()); await apply(store, first);
  await rename(path.join(root, "ms10001 - Song"), path.join(root, "My folder"));
  await apply(store, bundle(await document("Analysis", "Song", "G")));
  assert.equal((await store.scan()).files[0].path, "My folder/Analysis.mstruct");
  const other = await library(); await apply(other.store, first);
  const renamed = bundle(await document("New name"), { location: "ms10001 - New title/New name.mstruct" }); await apply(other.store, renamed);
  assert.equal((await other.store.scan()).files[0].path, renamed.catalog.analyses[0].path);
});
test("untracked occupied path requires a choice and casing collisions never overwrite", async () => {
  const { root, store } = await library(); await mkdir(path.join(root, "ms10001 - Song"));
  await writeFile(path.join(root, "ms10001 - Song/Analysis.mstruct"), await document("Analysis", "Song", "F"));
  const value = bundle(await document()); assert.equal((await store.planImport(value)).records[0].conflict, true);
  await assert.rejects(apply(store, value), /library-decision/);
  await assert.rejects(store.createAnalysis("ms10001 - Song", "analysis", "text"), /library-exists/);
  await assert.rejects(safePath(root, "../bad"), /library-path/);
});
test("transaction rollback and restart recovery preserve original bytes and reject stale plans", async () => {
  const { root, store } = await library(); await store.load(); await writeFile(path.join(root, "old.mstruct"), "old");
  await assert.rejects(transact(root, [{ path: "old.mstruct", data: "new" }, { path: "new.mstruct", data: "new" }], { failAfter: 0 }));
  assert.equal(await readFile(path.join(root, "old.mstruct"), "utf8"), "old");
  await mkdir(path.join(root, ".mstruct-library/recovery"), { recursive: true }); await writeFile(path.join(root, ".mstruct-library/recovery/old.bak"), "old");
  await writeFile(path.join(root, "old.mstruct"), "interrupted");
  await writeFile(path.join(root, ".mstruct-library/journal.json"), JSON.stringify({ version: 1, entries: [{ path: "old.mstruct", backup: ".mstruct-library/recovery/old.bak", hash: digest("old") }] }));
  await recover(root); assert.equal(await readFile(path.join(root, "old.mstruct"), "utf8"), "old");
  const value = bundle(await document()), plan = await store.planImport(value); await store.scan();
  await store.createAnalysis("", "Other", "text"); await writeFile(path.join(root, ".mstruct-library/state.json"), JSON.stringify({ version: 1, sources: {}, audio: {}, changed: true }));
  await assert.rejects(store.applyImport(value, plan), /library-stale/);
});
test("analysis rename updates metadata/source and local audio; audio collision aborts all writes", async () => {
  const { root, store } = await library(), first = bundle(await document()); await apply(store, first);
  const location = first.catalog.analyses[0].path, next = "ms10001 - Song/Renamed.mstruct";
  await writeFile(path.join(root, location.replace(".mstruct", ".wav")), "audio");
  await store.renameFile(location, next, renameLibraryAnalysis(await document(), "Renamed"));
  assert.equal((await store.scan()).state.sources["a:7"].localPath, next);
  assert.equal(await readFile(path.join(root, next.replace(".mstruct", ".wav")), "utf8"), "audio");
  await writeFile(path.join(root, "ms10001 - Song/Occupied.wav"), "other audio");
  await assert.rejects(store.renameFile(next, "ms10001 - Song/Occupied.mstruct", "replacement"), /library-exists/);
  assert.equal(parseMstructDocument(await readFile(path.join(root, next), "utf8")).metadata.versionName, "Renamed");
  await store.renameFile(next, "ms10001 - Song/RENAMED.mstruct", renameLibraryAnalysis(await document(), "RENAMED"));
  assert.equal((await store.scan()).files[0].path, "ms10001 - Song/RENAMED.mstruct");
  const update = bundle(await document("Updated", "Song", "G"), { location: "ms10001 - Song/Updated.mstruct" });
  assert.equal((await store.planImport(update)).records[0].conflict, true);
  await apply(store, update, { ms10001: "remote" });
  assert.equal((await store.scan()).files[0].path, "ms10001 - Song/Updated.mstruct");
});
test("offline title and technique intersection stays within one saved analysis and survives index cache", async () => {
  const files = [{ path: "one/A.mstruct", hash: "a", text: await document("A", "Alpha", "C") }, { path: "one/B.mstruct", hash: "b", text: await document("B", "Beta", "G") }, { path: "bad.mstruct", hash: "c", text: "bad source" }];
  const index = await buildLibraryIndex({ files, resolveProfile: async () => profile });
  assert.equal(index.entries.filter(entry => entry.status === "error").length, 1);
  assert.equal(searchLibrary(index, { song: "Alpha", technique: "G|*" }).entries.length, 0);
  assert.equal(searchLibrary(index, { song: "beta", technique: "G|*" }).entries[0].path, "one/B.mstruct");
  const cached = deserializeSearchVocabulary(JSON.parse(JSON.stringify(serializeSearchVocabulary(index))));
  const rebuilt = await buildLibraryIndex({ files, cached, resolveProfile: async () => profile });
  assert.equal(searchLibrary(rebuilt, { technique: "C|*" }).entries.length, 1);
  assert.equal(searchLibrary(index, { technique: "*|* --bogus" }).ok, false);
});
test("linked timelines share conflict decisions and remote path migrations preserve local audio bytes", async () => {
  const { root, store } = await library(), first = bundle(await document(), { timeline: "timeline one" }); await apply(store, first);
  const audioPath = path.join(root, "ms10001 - Song/Analysis.wav"); await writeFile(audioPath, "user audio");
  await writeFile(path.join(root, "ms10001 - Song/timeline-9.mstructtime"), "local timeline");
  const update = bundle(await document("New name"), { location: "ms10001 - New/New name.mstruct", timeline: "timeline two" });
  const plan = await store.planImport(update); assert.equal(plan.records.find(item => item.key === "t:9").conflict, true);
  await store.applyImport(update, plan, { ms10001: "remote" });
  assert.equal(await readFile(audioPath, "utf8"), "user audio");
  assert.equal((await store.audioState())["ms10001 - New/New name.mstruct"], audioPath);
  assert.equal(await readFile(path.join(root, "ms10001 - New/timeline-9.mstructtime"), "utf8"), "timeline two");
});
test("audio adapter finds stable/timeline recordings, remembers choices, copies safely and keeps external paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mstruct-audio-")), settings = path.join(root, "settings"); await mkdir(settings);
  const analysis = path.join(root, "Analysis.mstruct"), recording = Buffer.from("authored test recording"), alternate = Buffer.from("alternate authored recording");
  await writeFile(analysis, "test"); await writeFile(path.join(root, "Analysis.wav"), recording);
  await writeFile(path.join(root, "timeline-1.wav"), alternate);
  const handlers = new Map(), answers = [], selections = [];
  const options = { ipcMain: { handle: (key, action) => handlers.set(key, action) }, dialog: { async showOpenDialog() { return { filePaths: [selections.shift()] }; }, async showMessageBox() { return { response: answers.shift() }; } }, userData: settings, window: () => null, locale: () => "en", assertTrustedSender() {}, currentPath: () => analysis, library: { active: async () => null } };
  let audio = setupDesktopAudio(options);
  const find = value => handlers.get("mstruct-audio:find")({}, value), choose = value => handlers.get("mstruct-audio:choose")({}, value);
  let result = await find({ stable: true }); assert.equal(result.name, "Analysis.wav");
  result = await find({ stable: false, timeline: "timeline-1.mstructtime" }); assert.equal(result.name, "timeline-1.wav");
  assert.deepEqual(await find({ stable: false, timeline: "missing.mstructtime" }), { missing: true });
  const external = path.join(root, "External.wav"); await writeFile(external, alternate); selections.push(external); answers.push(1);
  await choose({ stable: false, timeline: "timeline-2.mstructtime" });
  audio = setupDesktopAudio(options); result = await find({ stable: false, timeline: "timeline-2.mstructtime" }); assert.equal(result.name, "External.wav");
  const response = await audio.response(result.url.split("/").at(-1)); assert.deepEqual(Buffer.from(await response.arrayBuffer()), alternate);
  selections.push(external); answers.push(0, 1); assert.equal((await choose({ stable: true })).cancelled, true); assert.deepEqual(await readFile(path.join(root, "Analysis.wav")), recording);
  selections.push(external); answers.push(0, 0); await choose({ stable: true }); assert.deepEqual(await readFile(path.join(root, "Analysis.wav")), alternate);
  await writeFile(path.join(root, "Analysis.mp3"), recording); result = await find({ stable: true }); assert.equal(result.name, "Analysis.wav");
  await writeFile(path.join(root, "Analysis.mp4"), alternate); result = await find({ stable: true }); assert.equal(result.name, "Analysis.mp4");
  const videoResponse = await audio.response(result.url.split("/").at(-1));
  assert.equal(videoResponse.headers.get("content-type"), "video/mp4");
  assert.deepEqual(Buffer.from(await videoResponse.arrayBuffer()), alternate);
  await writeFile(path.join(root, "timeline-1.mp4"), alternate);
  result = await find({ stable: false, timeline: "timeline-1.mstructtime" }); assert.equal(result.name, "timeline-1.mp4");
  assert.deepEqual(await readFile(external), alternate);
});
test("an extracted public package registers status/baselines, hides rules and preserves edited or missing files", async () => {
  const { root, store } = await library(), original = await document(), value = bundle(original);
  for (const [relative, data] of value.files) { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), data); }
  const relative = value.catalog.analyses[0].path, edited = await document("Analysis", "Locally edited", "F"); await writeFile(path.join(root, relative), edited);
  const extracted = await readExtractedPackage(root);
  assert.deepEqual(extracted.modified, [relative]);
  await validateLibraryPackage(Object.fromEntries([...extracted.files].filter(([, data]) => data).map(([name, data]) => [name, data.toString()])), extracted.catalog, { modified: extracted.modified });
  await store.adoptExtracted(extracted);
  const scanned = await store.scan(); assert.ok(scanned.state.snapshot); assert.equal(scanned.state.sources["a:7"].baseline, digest(original));
  assert.equal(await readFile(path.join(root, relative), "utf8"), edited);
  assert.ok(!scanned.folders.includes("rules") && !scanned.folders.includes(".rules")); assert.equal((await store.rules()).length, 1);
  assert.ok((await stat(path.join(root, ".rules"))).isDirectory()); await assert.rejects(stat(path.join(root, "rules")), { code: "ENOENT" });
  assert.equal((await readExtractedPackage(root)).modified.length, 1);
  assert.equal(await store.adoptExtracted(extracted), false);
});
test("library indexing downloads missing exact rules then falls back offline within the same version without rewriting scores", async () => {
  const source = await document(), original = parseMstructDocument(source), oldHash = `sha256:${"f".repeat(64)}`;
  const text = serializeMstructDocument({ ...original, metadata: { ...original.metadata, mstructProfileHash: oldHash } }); let downloads = 0;
  const profiles = createStandaloneProfiles({ embeddedProfile: async () => profile, platform: {
    profileState: async () => ({ url: "https://fixture.invalid/rules", installed: [], index: null }), profilePut: async () => {}, profileGet: async () => null,
    profileFetch: async () => { downloads++; throw Error("offline"); },
  } });
  const index = await buildLibraryIndex({ files: [{ path: "Analysis.mstruct", text, hash: digest(text) }], resolveProfile: identity => profiles.resolveForIndex(identity) });
  assert.equal(index.entries[0].status, "ready"); assert.equal(index.entries[0].usedProfileHash, profile.manifest.bundleHash);
  assert.equal(parseMstructDocument(text).metadata.mstructProfileHash, oldHash); assert.equal(downloads, 1);
});
