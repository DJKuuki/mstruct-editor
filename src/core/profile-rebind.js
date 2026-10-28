import { parseMstructDocument } from "./mstruct-document.js";
import { isVerifiedMstructProfile } from "./profile.js";
import { MstructProfileError, readProfileIdentity } from "./profile-schema.js";

/** Change only system binding values, even when the music has syntax errors.
 * Preserve every other byte, including line endings, notes and COMMENT text. */
export function rebindDocumentProfile(input, target) {
  if (!isVerifiedMstructProfile(target)) throw new MstructProfileError("profile-unverified");
  const source = String(input ?? ""), document = parseMstructDocument(source);
  const previous = readProfileIdentity(document.metadata);
  if (!previous) throw new MstructProfileError("profile-assignment-required");
  if (previous.formatVersion !== target.manifest.formatVersion) throw new MstructProfileError("format-version-unsupported", { version: String(previous.formatVersion) });
  const values = { MSTRUCT_FORMAT_VERSION: String(target.manifest.formatVersion), MSTRUCT_PROFILE_ID: target.manifest.profileId, MSTRUCT_PROFILE_HASH: target.manifest.bundleHash };
  const counts = new Map(); let metadata = false, comments = false, ended = false;
  const rebound = source.replace(/[^\r\n]+/g, (line) => {
    const trimmed = line.replace(/^\uFEFF/, "").trim();
    if (!metadata) { if (!ended && trimmed === "METADATA:") metadata = true; return line; }
    if (comments) { if (trimmed === "{COMMENTS_END}") comments = false; return line; }
    if (trimmed === "{COMMENTS}") { comments = true; return line; }
    if (trimmed === "END_METADATA") { metadata = false; ended = true; return line; }
    return line.replace(/\{(MSTRUCT_FORMAT_VERSION|MSTRUCT_PROFILE_ID|MSTRUCT_PROFILE_HASH)\}([^{}]*)/g, (_match, key, value) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const whitespace = value.match(/^(\s*).*?(\s*)$/);
      return `{${key}}${whitespace[1]}${values[key]}${whitespace[2]}`;
    });
  });
  if (!ended || Object.keys(values).some(key => counts.get(key) !== 1)) throw new MstructProfileError("profile-identity-mismatch");
  return { source: rebound, previous, document: parseMstructDocument(rebound) };
}
