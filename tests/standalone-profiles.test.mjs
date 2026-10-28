import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createMstructProfile, verifyMstructProfile } from "../src/core/profile.js";
import { assignDocumentProfile } from "../src/core/profile-document.js";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { createStandaloneProfiles, validateProfileIndex } from "../src/runtime/standalone-profiles.js";
import { createDocumentProfileSession } from "../src/runtime/document-profile.js";
import { createAnalysisDocumentLoader } from "../src/runtime/analysis-document-loader.js";
import { setupDocumentSession } from "../src/runtime/document-session.js";
import { syntaxErrorMessage } from "../src/editor-i18n.js";
const { createProfileStore, identityKey, registryUrl, DEFAULT_REGISTRY_URL } = createRequire(import.meta.url)("../desktop/profile-store.cjs");
const embedded = await verifyMstructProfile(JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url), "utf8")));
const source = "{BN:1}{TS:adlib}{D:1}[C:C];";
function platformFixture(index = null) {
  const bundles = new Map(), calls = [];
  const k = (identity) => JSON.stringify([identity.profileId, identity.bundleHash]);
  const platform = {
    profileState: async () => ({ url: "https://registry.test/api/mstruct-profiles", index, installed: [...bundles.values()].map((b) => b.manifest) }),
    profileGet: async (identity) => bundles.get(k(identity)) ?? null,
    profilePut: async (bundle) => bundles.set(k(bundle.manifest), bundle),
    profileFetch: async (identity) => { calls.push(identity); throw Error("offline"); },
    profileSaveIndex: async (value) => { index = value; },
    profileConfigure: async () => {}, profileImport: async () => null,
  };
  return { platform, bundles, calls, k };
}
const service = (platform) => createStandaloneProfiles({ platform, embeddedProfile: async () => embedded, authoringAppVersion: "test" });

test("first offline startup resolves the formal embedded bundle and K545 without network", async () => {
  const f = platformFixture(), runtime = service(f.platform);
  const example = await readFile(new URL("../examples/k545.mstruct", import.meta.url), "utf8");
  assert.equal((await runtime.prepareOpen(example)).changed, false);
  assert.equal((await runtime.recommended()).manifest.bundleHash, embedded.manifest.bundleHash);
  assert.equal(f.calls.length, 0);
  assert.equal((await runtime.assign(source)).ok, true);
  assert.equal((await runtime.assign("{BN:1}{TS:adlib}{D:1}[C:INVALID];")).ok, false);
});

test("editing trusts the same version line even when a legacy build fails the compatibility diff", async () => {
  const next = await createMstructProfile({ profileId: embedded.manifest.profileId,
    files: { ...embedded.files, "tags.csv": `${embedded.files["tags.csv"]}<DesktopAdded>,桌面新增,Desktop Added,1\n` } });
  const index = { lines: [{ profileId: next.manifest.profileId, version: "1.0.0", currentHash: next.manifest.bundleHash }], default: next.manifest };
  const f = platformFixture(index), runtime = service(f.platform);
  await runtime.ready;
  const original = (await assignDocumentProfile(source, embedded)).source;
  assert.equal((await runtime.prepareOpen(original)).changed, false);
  f.bundles.set(f.k(next.manifest), next);
  const changed = await runtime.prepareOpen(original);
  assert.equal(changed.changed, false); assert.equal(changed.rulesUpdated, true);
  assert.equal(parseMstructDocument(changed.source).metadata.mstructProfileHash, next.manifest.bundleHash);
  assert.equal((await runtime.resolve(embedded.manifest)).manifest.bundleHash, embedded.manifest.bundleHash);
  const incompatible = await createMstructProfile({ profileId: embedded.manifest.profileId,
    files: { ...embedded.files, "roman-basic.csv": embedded.files["roman-basic.csv"].replace('"+,DM"', "DM") } });
  assert.notEqual(incompatible.manifest.bundleHash, embedded.manifest.bundleHash);
  const bad = platformFixture({ ...index, lines: [{ ...index.lines[0], currentHash: incompatible.manifest.bundleHash }] });
  bad.bundles.set(bad.k(incompatible.manifest), incompatible);
  const adopted = await service(bad.platform).prepareOpen(original);
  assert.equal(adopted.changed, false); assert.equal(adopted.rulesUpdated, true);
  assert.equal(parseMstructDocument(adopted.source).metadata.mstructProfileHash, incompatible.manifest.bundleHash);
});

test("new files use the current hash while arbitrary old hashes in the same version open silently", async () => {
  const latest = await createMstructProfile({ profileId: embedded.manifest.profileId,
    files: { ...embedded.files, "tags.csv": `${embedded.files["tags.csv"]}<LatestDefault>,最新默认,Latest Default,1\n` } });
  const f = platformFixture({ lines: [{ profileId: latest.manifest.profileId, version: latest.manifest.version, currentHash: latest.manifest.bundleHash }], default: latest.manifest });
  f.bundles.set(f.k(latest.manifest), latest);
  const runtime = service(f.platform);
  assert.equal((await runtime.recommended()).manifest.bundleHash, latest.manifest.bundleHash);
  const original = (await assignDocumentProfile(source, embedded)).source;
  for (const hash of [embedded.manifest.bundleHash, `sha256:${"0".repeat(64)}`, `sha256:${"1".repeat(64)}`]) {
    const prepared = await runtime.prepareOpen(original.replace(embedded.manifest.bundleHash, hash));
    assert.equal(prepared.error, undefined); assert.equal(prepared.changed, false);
    assert.equal(parseMstructDocument(prepared.source).metadata.mstructProfileHash, latest.manifest.bundleHash);
  }
});

test("offline editing adopts a compatible embedded update without a registry refresh or manual migration", async () => {
  const next = await createMstructProfile({ profileId: embedded.manifest.profileId,
    files: { ...embedded.files, "tags.csv": `${embedded.files["tags.csv"]}<OfflineAdded>,离线新增,Offline Added,1\n` } });
  const f = platformFixture(), original = (await assignDocumentProfile(source, embedded)).source;
  f.bundles.set(f.k(embedded.manifest), embedded);
  const runtime = createStandaloneProfiles({ platform: f.platform, embeddedProfile: async () => next, authoringAppVersion: "test" });
  const opened = await runtime.prepareOpen(original);
  assert.equal(opened.changed, false); assert.equal(opened.rulesUpdated, true);
  assert.equal(parseMstructDocument(opened.source).metadata.mstructProfileHash, next.manifest.bundleHash);
  assert.equal((await runtime.resolve(embedded.manifest)).manifest.bundleHash, embedded.manifest.bundleHash);
  assert.equal(f.calls.length, 0);
});

test("exact resolution still rejects missing or damaged builds while editing can use verified same-version rules", async () => {
  const f = platformFixture(), runtime = service(f.platform);
  await runtime.ready;
  const identity = { ...embedded.manifest, bundleHash: `sha256:${"0".repeat(64)}` };
  await assert.rejects(runtime.resolve(identity), /offline/);
  f.bundles.set(f.k(identity), embedded);
  await assert.rejects(runtime.resolve(identity), (error) => error.code === "profile-identity-mismatch");
  f.platform.profileImport = async () => ({ ...embedded, files: { ...embedded.files, "tags.csv": "bad" } });
  await assert.rejects(runtime.import());
  assert.equal(f.bundles.size, 2);
  const document = (await assignDocumentProfile(source, embedded)).source.replace(embedded.manifest.bundleHash, identity.bundleHash);
  const recovered = await runtime.prepareOpen(document);
  assert.equal(recovered.changed, false); assert.equal(recovered.rulesUpdated, true);
  assert.equal(recovered.source, document.replace(identity.bundleHash, embedded.manifest.bundleHash));
  f.bundles.delete(f.k(identity));
  assert.equal((await runtime.prepareOpen(document)).changed, false);
  assert.equal((await runtime.prepareOpen(source)).assignmentRequired, true);
  assert.throws(() => validateProfileIndex({ lines: [{ profileId: embedded.manifest.profileId, version: "1.0.0", currentHash: "bad" }] }));
});

test("missing historical SHA opens offline without contacting a closed registry and preserves all other bytes", async () => {
  const f = platformFixture({ lines: [{ profileId: embedded.manifest.profileId, version: "1.0.0", currentHash: `sha256:${"1".repeat(64)}` }] });
  const runtime = service(f.platform), absentHash = `sha256:${"0".repeat(64)}`;
  const original = "\uFEFF" + (await assignDocumentProfile(source, embedded)).source
    .replace(embedded.manifest.bundleHash, absentHash).replaceAll("\n", "\r\n");
  const opened = await runtime.prepareOpen(original);
  assert.equal(opened.error, undefined);
  assert.equal(opened.changed, false); assert.equal(opened.rulesUpdated, true);
  assert.equal(opened.source, original.replace(absentHash, embedded.manifest.bundleHash));
  assert.equal(f.calls.length, 0);
  // An unfinished analysis remains editable so its actual syntax errors can be fixed.
  const invalid = original.replace("[C:C]", "[C:INVALID]");
  assert.equal((await runtime.prepareOpen(invalid)).source, invalid.replace(absentHash, embedded.manifest.bundleHash));
  const session = createDocumentProfileSession({ resolveProfile: runtime.resolve, commit: () => {} });
  const loader = createAnalysisDocumentLoader({ hostedMode: false, profileSession: session,
    prepareStandalone: runtime.prepareOpen, getMetadata: () => ({}), metadataAfterImport: (m) => m,
    applyDocument: () => {}, render: (document) => session.compile(document.main, document.metadata, document.comments),
    setError: (error) => assert.fail(JSON.stringify(error)),
  });
  assert.deepEqual(await loader(original), { loaded: true, scoreOk: true, changed: false });
  assert.equal(session.error, null);
  assert.equal(f.calls.length, 0);
});

test("another installed build in the same custom version line works offline but another ID or version does not", async () => {
  const installed = await createMstructProfile({ profileId: "org.mstruct.custom/rulesets/1.0.0", files: embedded.files });
  const original = (await assignDocumentProfile(source, installed)).source;
  const missing = original.replace(installed.manifest.bundleHash, `sha256:${"0".repeat(64)}`);
  const f = platformFixture();
  f.bundles.set(f.k(installed.manifest), installed);
  const runtime = service(f.platform);
  assert.equal((await runtime.prepareOpen(missing)).source, original);
  assert.equal(f.calls.length, 0);
  for (const id of ["org.mstruct.custom/rulesets/2.0.0", "org.mstruct.other/rulesets/1.0.0"]) {
    const unavailable = await runtime.prepareOpen(missing.replace(installed.manifest.profileId, id));
    assert.equal(unavailable.error.code, "profile-missing");
  }
  assert.ok((await runtime.prepareOpen(missing.replace("{MSTRUCT_FORMAT_VERSION}1", "{MSTRUCT_FORMAT_VERSION}2"))).error);
});

test("native storage survives restart, uses bounded JSON transport and rejects path or URL injection", async () => {
  const scratch = new URL("../.test-tmp/", import.meta.url);
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(new URL("mstruct-profiles-", scratch));
  try {
    const requests = [];
    const store = createProfileStore(directory, { fetchJson: async (url, options) => { requests.push({ url, options }); return Response.json(embedded); } });
    assert.equal((await store.state()).url, "https://mstruct-archive.com/api/mstruct-profiles");
    await store.fetch(embedded.manifest);
    assert.equal(new URL(requests.pop().url).origin, new URL(DEFAULT_REGISTRY_URL).origin);
    await store.put(embedded);
    await store.configure("https://registry.test/api/mstruct-profiles");
    const restarted = createProfileStore(directory);
    assert.deepEqual(await restarted.get(embedded.manifest), embedded);
    assert.equal((await restarted.state()).installed.length, 1);
    assert.equal((await restarted.state()).url, "https://registry.test/api/mstruct-profiles");
    await store.fetch(embedded.manifest);
    assert.equal(new URL(requests[0].url).searchParams.get("hash"), embedded.manifest.bundleHash);
    assert.equal(requests[0].options.redirect, "error");
    assert.throws(() => identityKey({ profileId: "../../outside", bundleHash: "../../outside" }));
    assert.throws(() => registryUrl("file:///C:/secret"));
    assert.throws(() => registryUrl("https://user:password@registry.test"));
    await writeFile(path.join(directory, "mstruct-profiles", `${identityKey(embedded.manifest)}.json`), "bad JSON");
    await assert.rejects(restarted.get(embedded.manifest));
    assert.equal((await restarted.state()).installed.length, 0);
    const oversized = createProfileStore(directory, { fetchJson: async () => new Response(" ".repeat(4 * 1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } }) });
    await assert.rejects(oversized.fetch(), /size limit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("read-only loader clears old profile and document saves cannot overwrite unresolved source", async () => {
  const profileSession = createDocumentProfileSession({ resolveProfile: async () => embedded, commit: () => {} });
  await profileSession.load(parseMstructDocument((await assignDocumentProfile(source, embedded)).source).metadata);
  const loader = createAnalysisDocumentLoader({ hostedMode: false, profileSession,
    prepareStandalone: async (text) => ({ source: text, error: { code: "profile-missing" } }),
    getMetadata: () => ({}), metadataAfterImport: (m) => m, applyDocument: () => {},
    render: () => ({ ok: false }), setError: () => {},
  });
  assert.equal((await loader(source)).loaded, true);
  assert.equal(profileSession.profile, null);
  const unresolved = profileSession.compile(source, {}, []);
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.errors[0].metadataDomain, true);
  const detail = { ...unresolved.errors[0], details: { profileId: "rules/1.0.0", bundleHash: "hash" } };
  assert.match(syntaxErrorMessage(detail, "zh"), /缺少规则 rules\/1.0.0/);
  assert.match(syntaxErrorMessage(detail, "en"), /Missing rules rules\/1.0.0/);
  const handlers = {}, button = { addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener: () => {} };
  let saved = false, command;
  const session = setupDocumentSession({ adapter: { kind: "desktop", onCommand: (fn) => { command = fn; }, save: async () => { saved = true; } },
    newButton: button, importButton: button, exportButton: button, importInput: button,
    canSave: () => false, setStatus: () => {}, tr: (s) => s });
  command("save");
  assert.equal(saved, false);
  session.destroy();
});
