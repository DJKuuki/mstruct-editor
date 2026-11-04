import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createMstructProfile, verifyMstructProfile } from "../src/core/profile.js";
import { assignDocumentProfile } from "../src/core/profile-document.js";
import { createEmptyMetadata, serializeMstructDocument } from "../src/core/mstruct-document.js";
import { prepareLibraryMigration } from "../src/core/library-migration.js";

const require = createRequire(import.meta.url);
const { createLibraryStore } = require("../desktop/library-store.cjs");
const { digest } = require("../desktop/library-paths.cjs");
const filesystem = require("node:fs/promises");
const profile = await verifyMstructProfile(JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url))));
const target = await createMstructProfile({ profileId: profile.manifest.profileId, files: {
  ...profile.files, "toolbox-events.csv": profile.files["toolbox-events.csv"].replace("Final Barline", "Final Barline updated"),
} });
const unbound = serializeMstructDocument({ metadata: { ...createEmptyMetadata(), versionName: "Analysis" }, main: "{BN:1}{TS:4/4}{D:1}{TC:C}C|I;" });
const source = (await assignDocumentProfile(unbound, profile)).source;
const file = (name, text = source) => ({ path: name, text, hash: digest(text) });

test("migration scans all analyses, preserves bound bytes, assigns legacy files and isolates invalid inputs", async () => {
  const formatted = "\uFEFF" + source.replaceAll("\n", "\r\n");
  const current = (await assignDocumentProfile(unbound, target)).source;
  const plan = await prepareLibraryMigration([
    file("nested/Analysis.MSTRUCT", formatted), file("Legacy.mstruct", unbound), file("Current.mstruct", current),
    file("Invalid.mstruct", source.replace("C|I;", "???;")), { path: "Large.mstruct", error: "library-size" }, file("Timing.mstructtime", "irrelevant"),
  ], target, "1.0.28");
  assert.deepEqual(plan.records.map(record => record.status), ["ready", "ready", "current", "error", "error"]);
  assert.equal(plan.records[0].text, formatted.replace(profile.manifest.bundleHash, target.manifest.bundleHash));
  assert.ok(plan.records[1].text.includes(target.manifest.bundleHash));
  assert.equal(plan.records[4].errors[0].code, "library-size");
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mstruct-migration-"));
  const store = createLibraryStore(root);
  await store.load();
  await store.createFolder("", "Nested");
  await store.createAnalysis("Nested", "Analysis", source);
  await writeFile(path.join(root, "Audio.mp3"), "audio");
  await writeFile(path.join(root, "Timing.mstructtime"), "timeline");
  const snapshot = await store.scan();
  const plan = await prepareLibraryMigration(snapshot.files, target);
  return { root, store, changes: plan.records.filter(record => record.status === "ready") };
}

test("migration retains originals and rules, rebuilds from changed files and is idempotent", async () => {
  const { root, store, changes } = await fixture();
  const manifestPath = path.join(root, `.rules/${target.manifest.bundleHash.slice(7)}/manifest.json`);
  const formattedManifest = JSON.stringify(target.manifest, null, 2) + "\n";
  await filesystem.mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, formattedManifest);
  await store.writeCache({ old: true });
  const result = await store.migrate({ root, changes, profile: target });
  assert.equal(result.written, 1);
  assert.equal(await readFile(path.join(result.backup, "files/Nested/Analysis.mstruct"), "utf8"), source);
  assert.equal(await readFile(path.join(root, "Nested/Analysis.mstruct"), "utf8"), changes[0].text);
  assert.equal(await readFile(path.join(root, "Audio.mp3"), "utf8"), "audio");
  assert.equal(await readFile(path.join(root, "Timing.mstructtime"), "utf8"), "timeline");
  assert.equal((await store.rules())[0].manifest.bundleHash, target.manifest.bundleHash);
  assert.equal(await readFile(manifestPath, "utf8"), formattedManifest);
  const scanned = await store.scan();
  assert.equal(scanned.cache, null);
  assert.deepEqual((await prepareLibraryMigration(scanned.files, target)).records.map(record => record.status), ["current"]);
});

test("changed files or library roots reject the complete batch before writing", async () => {
  const { root, store, changes } = await fixture();
  await store.createAnalysis("", "Second", source);
  const second = file("Second.mstruct");
  const prepared = await prepareLibraryMigration([second], target);
  await writeFile(path.join(root, second.path), source + "\n");
  await assert.rejects(store.migrate({ root, changes: [...changes, ...prepared.records], profile: target }), /library-stale/);
  assert.equal(await readFile(path.join(root, "Nested/Analysis.mstruct"), "utf8"), source);
  await assert.rejects(store.migrate({ root: root + "-different", changes, profile: target }), /library-stale/);
});

test("unsafe paths and failed filesystem writes roll back analyses and retained backups", async () => {
  const { root, store, changes } = await fixture();
  await assert.rejects(store.migrate({ root, changes: [{ ...changes[0], path: "../Outside.mstruct" }], profile: target }), /library-path/);
  const rename = filesystem.rename;
  let interrupted = false;
  filesystem.rename = async (from, to) => {
    if (!interrupted && to === path.join(root, ".rules", target.manifest.bundleHash.slice(7), "manifest.json")) {
      interrupted = true;
      assert.equal(await readFile(path.join(root, "Nested/Analysis.mstruct"), "utf8"), changes[0].text);
      throw Error("simulated interrupted migration");
    }
    return rename(from, to);
  };
  try { await assert.rejects(store.migrate({ root, changes, profile: target }), /simulated interrupted migration/); }
  finally { filesystem.rename = rename; }
  assert.equal(interrupted, true);
  assert.equal(await readFile(path.join(root, "Nested/Analysis.mstruct"), "utf8"), source);
});
