// Data-only distribution entry for all three runtimes. Hosts inject resolution;
// a profile registry never supplies executable compiler code.
export { createMstructProfile, normalizeProfileCsv, verifyMstructProfile } from "./core/profile.js";
export { compareMstructProfiles, nextProfileVersion } from "./core/profile-diff.js";
export { assignDocumentProfile, compileProfileDocument, resolveMstructDocument } from "./core/profile-document.js";
export { rebindDocumentProfile } from "./core/profile-rebind.js";
export { reportDocumentProfileMigration, prepareCompatibleProfileUpgrade } from "./core/profile-migration.js";
export { createProfileSearchVocabulary, serializeSearchVocabulary, deserializeSearchVocabulary, parseProfileSearchQuery } from "./core/profile-search.js";
export { INITIAL_PROFILE_ID, MstructProfileError, MSTRUCT_FORMAT_VERSION, PROFILE_FILES,
  PROFILE_MANIFEST_VERSION, readProfileIdentity } from "./core/profile-schema.js";
export { createProfileResolver, prepareDocumentProfile } from "./runtime/profile-resolver.js";
export { BUILTIN_PROFILE_FILES, getBuiltinMstructProfile } from "./runtime/builtin-profile.js";
export { getEmbeddedMstructProfile } from "./runtime/embedded-profile.js";
