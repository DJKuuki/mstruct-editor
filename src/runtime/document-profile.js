import { compileProfileDocument } from "../core/profile-document.js";
import { readProfileIdentity, MstructProfileError } from "../core/profile-schema.js";
import { prepareDocumentProfile } from "./profile-resolver.js";
import { parseMstruct } from "../core/mstruct.js";
import { parseMstructDocument } from "../core/mstruct-document.js";
import { prepareCompatibleProfileUpgrade } from "../core/profile-migration.js";
import { verifyMstructProfile } from "../core/profile.js";

/** The runtime owns resolution; the shared UI receives only a complete snapshot. */
export function createDocumentProfileSession({ resolveProfile, commit }) {
  let profile = null, error = null, generation = 0;
  return {
    get profile() { return profile; },
    get error() { return error; },
    clear() { generation += 1; profile = null; error = null; },
    block(reason) { generation += 1; profile = null; error = reason ?? { code: "profile-missing" }; },
    async load(metadata, candidate) {
      const ticket = ++generation;
      profile = null;
      error = { code: "profile-missing" };
      try {
        const identity = readProfileIdentity(metadata);
        if (!identity) throw new MstructProfileError("profile-assignment-required");
        const input = candidate ?? await resolveProfile(identity);
        if (!input) throw new MstructProfileError("profile-missing", identity);
        const prepared = await prepareDocumentProfile(input, identity);
        if (ticket !== generation) return { ok: false, cancelled: true };
        commit(prepared);
        profile = prepared.profile;
        error = null;
        return { ok: true, profile };
      } catch (failure) {
        if (ticket !== generation) return { ok: false, cancelled: true };
        error = { code: failure.code ?? "profile-missing", details: failure.details };
        return { ok: false, error };
      }
    },
    async prepareImport(source) {
      const ticket = generation, target = profile;
      const document = parseMstructDocument(source);
      if (!document.ok) return source;
      const identity = readProfileIdentity(document.metadata);
      if (!identity) return source;
      if (!target || error) throw new MstructProfileError("profile-missing", identity);
      if (identity.profileId === target.manifest.profileId && identity.bundleHash === target.manifest.bundleHash) return source;
      if (identity.profileId !== target.manifest.profileId || identity.formatVersion !== target.manifest.formatVersion) throw new MstructProfileError("profile-identity-mismatch");
      const previous = await verifyMstructProfile(await resolveProfile(identity), identity);
      if (ticket !== generation || target !== profile) throw new MstructProfileError("profile-identity-mismatch");
      const prepared = await prepareCompatibleProfileUpgrade(source, target, async () => previous);
      if (ticket !== generation || target !== profile || !prepared.upgraded) throw new MstructProfileError("profile-identity-mismatch");
      return prepared.source;
    },
    compile(main, metadata, comments) {
      if (profile && !error) {
        try { return compileProfileDocument({ main, metadata, comments }, profile); }
        catch (failure) { error = { code: failure.code ?? "profile-identity-mismatch", details: failure.details }; }
      }
      return { ...parseMstruct(""), ok: false, errors: [{ ...(error ?? { code: "profile-missing" }), metadataDomain: true }], globalTags: [] };
    },
  };
}
