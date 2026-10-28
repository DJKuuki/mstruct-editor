import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as distributed from "../dist/profile.js";
import { createMstructProfile } from "../src/core/profile.js";
import { createEmptyMetadata, serializeMstructDocument } from "../src/core/mstruct-document.js";

const files = Object.fromEntries(await Promise.all(distributed.PROFILE_FILES.map(async ({ name }) => [name,
  await readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8")])));
const expected = await createMstructProfile({ profileId: distributed.INITIAL_PROFILE_ID, files });
const builtin = await distributed.getBuiltinMstructProfile();
assert.deepEqual(builtin, expected);
const source = serializeMstructDocument({ metadata: createEmptyMetadata(), main: "{BN:1}{TS:4/4}{D:1}[C:C];" });
const assigned = await distributed.assignDocumentProfile(source, builtin, "build-verification");
assert.equal(assigned.ok, true);
const resolved = await distributed.resolveMstructDocument(assigned.source, async () => builtin);
assert.equal(resolved.ok, true);
assert.equal(resolved.profile.manifest.bundleHash, expected.manifest.bundleHash);
assert.equal(resolved.document.metadata.authoringAppVersion, "build-verification");
const identity = distributed.readProfileIdentity(resolved.document.metadata);
assert.ok(identity.bundleHash.startsWith("sha256:"));
await assert.rejects(distributed.resolveMstructDocument(assigned.source, async () => null), (error) => error.code === "profile-missing");
console.log(`Built profile verified: ${builtin.manifest.profileId} ${identity.bundleHash}`);
const embedded = await distributed.getEmbeddedMstructProfile();
const example = await readFile(new URL("../examples/k545.mstruct", import.meta.url), "utf8");
assert.equal((await distributed.resolveMstructDocument(example, async () => embedded)).ok, true);
console.log(`Embedded formal profile verified: ${embedded.manifest.bundleHash}`);
