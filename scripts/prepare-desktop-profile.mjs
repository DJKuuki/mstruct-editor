import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMstructProfile, verifyMstructProfile } from "../src/core/profile.js";
import { PROFILE_FILES } from "../src/core/profile-schema.js";
import { rebindDocumentProfile } from "../src/core/profile-rebind.js";
import { compileProfileDocument } from "../src/core/profile-document.js";

/** Desktop packaging explicitly snapshots the current complete rule tables. */
export async function prepareDesktopProfile({
  configDirectory = fileURLToPath(new URL("../src/config/", import.meta.url)),
  exampleFile = fileURLToPath(new URL("../examples/k545.mstruct", import.meta.url)),
} = {}) {
  const snapshotFile = resolve(configDirectory, "official-profile.json");
  const [snapshotText, example] = await Promise.all([
    readFile(snapshotFile, "utf8"), readFile(exampleFile, "utf8"),
  ]);
  const previous = await verifyMstructProfile(JSON.parse(snapshotText));
  const files = Object.fromEntries(await Promise.all(PROFILE_FILES.map(async ({ name }) =>
    [name, await readFile(resolve(configDirectory, name), "utf8")])));
  const profile = await createMstructProfile({ profileId: previous.manifest.profileId, files });
  const rebound = rebindDocumentProfile(example, profile);
  const compiled = compileProfileDocument(rebound.document, profile);
  if (!compiled.ok) throw new Error(`Desktop startup example is invalid: ${compiled.errors.map(error => error.code).join(", ")}`);
  const snapshot = `${JSON.stringify(profile, null, 2)}\n`;
  if (snapshot !== snapshotText) await writeFile(snapshotFile, snapshot, "utf8");
  if (rebound.source !== example) await writeFile(exampleFile, rebound.source, "utf8");
  return { profileId: profile.manifest.profileId, bundleHash: profile.manifest.bundleHash,
    files: PROFILE_FILES.length, updated: profile.manifest.bundleHash !== previous.manifest.bundleHash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepareDesktopProfile()));
}
