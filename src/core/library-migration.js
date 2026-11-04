import { parseMstructDocument } from "./mstruct-document.js";
import { readProfileIdentity } from "./profile-schema.js";
import { rebindDocumentProfile } from "./profile-rebind.js";
import { assignDocumentProfile, compileProfileDocument } from "./profile-document.js";

/** Prepare every analysis in the library, independently of the visible folder or search. */
export async function prepareLibraryMigration(files, profile, authoringAppVersion) {
  const records = [];
  for (const file of files.filter(item => /\.mstruct$/i.test(item.path))) {
    const record = { path: file.path, expected: file.hash, status: "error" };
    records.push(record);
    try {
      if (file.error) throw Error(file.error);
      const document = parseMstructDocument(file.text);
      if (!document.ok) { record.errors = document.errors; continue; }
      const identity = readProfileIdentity(document.metadata);
      if (identity?.profileId === profile.manifest.profileId && identity.bundleHash === profile.manifest.bundleHash) {
        record.status = "current";
        continue;
      }
      const candidate = identity
        ? rebindDocumentProfile(file.text, profile)
        : await assignDocumentProfile(file.text, profile, authoringAppVersion);
      if (candidate.ok === false) { record.errors = candidate.errors; continue; }
      const result = compileProfileDocument(candidate.document, profile);
      if (!result.ok) { record.errors = result.errors; continue; }
      record.status = "ready";
      record.text = candidate.source;
    } catch (error) {
      record.errors = [{ code: error.code ?? error.message }];
    }
  }
  return { records, target: profile.manifest };
}
