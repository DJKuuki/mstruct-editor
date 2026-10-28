import { normalizeMetadata, parseMstructDocument, serializeMstructDocument } from "./mstruct-document.js";
import { parseMstruct } from "./mstruct.js";
import { parseGlobalTagList } from "./semantic-tags.js";
import { parseProfileConfig } from "./profile-config.js";
import { isVerifiedMstructProfile, verifyMstructProfile } from "./profile.js";
import { MstructProfileError, readProfileIdentity } from "./profile-schema.js";

const FORMAT_COMPILERS = new Map([[1, parseMstruct]]);

/** This boundary, not MAIN's syntax parser, selects the file format and rules. */
export function compileProfileDocument(document, profile) {
  if (!isVerifiedMstructProfile(profile)) throw new MstructProfileError("profile-unverified");
  const identity = readProfileIdentity(document.metadata);
  if (!identity) throw new MstructProfileError("profile-assignment-required");
  const compiler = FORMAT_COMPILERS.get(identity.formatVersion);
  if (!compiler) throw new MstructProfileError("format-version-unsupported", { version: String(identity.formatVersion) });
  if (identity.profileId !== profile.manifest.profileId || identity.bundleHash !== profile.manifest.bundleHash) {
    throw new MstructProfileError("profile-identity-mismatch", identity);
  }
  const config = parseProfileConfig(profile.files);
  const globalTags = parseGlobalTagList(document.metadata.globalTags, config);
  const result = compiler(document.main, { ...config, comments: document.comments,
    isStableTempo: document.metadata.isStableTempo, globalTags: globalTags.tags });
  const errors = [...result.errors, ...globalTags.errors.map((error) => ({ ...error, metadataDomain: true }))];
  return { ...result, ok: result.ok && globalTags.ok, errors, globalTags: globalTags.tags, profile, config };
}

/** Resolver is injected by hosted, desktop or the dev shell; no fallback exists. */
export async function resolveMstructDocument(source, resolveProfile) {
  const document = parseMstructDocument(source);
  if (!document.ok) return { ok: false, document, errors: document.errors, result: null, profile: null };
  const identity = readProfileIdentity(document.metadata);
  if (!identity) throw new MstructProfileError("profile-assignment-required");
  const candidate = await resolveProfile(identity);
  if (!candidate) throw new MstructProfileError("profile-missing", identity);
  const profile = await verifyMstructProfile(candidate, identity);
  const result = compileProfileDocument(document, profile);
  return { ok: result.ok, document, result, profile, errors: result.errors };
}

/** Assigning an unversioned file or migrating a versioned one requires validation. */
export async function assignDocumentProfile(source, candidate, authoringAppVersion) {
  const document = parseMstructDocument(source);
  if (!document.ok) return { ok: false, source, document, errors: document.errors };
  const profile = await verifyMstructProfile(candidate);
  const metadata = normalizeMetadata({ ...document.metadata,
    mstructFormatVersion: String(profile.manifest.formatVersion),
    mstructProfileId: profile.manifest.profileId, mstructProfileHash: profile.manifest.bundleHash,
    authoringAppVersion: authoringAppVersion ?? document.metadata.authoringAppVersion,
  });
  const assigned = { ...document, metadata };
  const result = compileProfileDocument(assigned, profile);
  if (!result.ok) return { ok: false, source, document, errors: result.errors };
  return { ok: true, document: assigned, errors: [], source: serializeMstructDocument(assigned), profile };
}
