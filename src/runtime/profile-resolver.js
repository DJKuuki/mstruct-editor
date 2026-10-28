import { parseProfileConfig } from "../core/profile-config.js";
import { verifyMstructProfile } from "../core/profile.js";
import { MstructProfileError } from "../core/profile-schema.js";

/** Instance-local cache: two iframes/documents never share mutable rule state. */
export function createProfileResolver({ resolveProfile }) {
  const cache = new Map();
  return {
    async resolve(identity) {
      const key = JSON.stringify([identity.profileId, identity.bundleHash, identity.formatVersion]);
      if (!cache.has(key)) {
        const pending = (async () => {
          const candidate = await resolveProfile(identity);
          if (!candidate) throw new MstructProfileError("profile-missing", identity);
          return verifyMstructProfile(candidate, identity);
        })();
        cache.set(key, pending);
        pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      }
      return cache.get(key);
    },
  };
}

/** A complete verified profile is prepared before any caller replaces its UI state. */
export async function prepareDocumentProfile(candidate, identity) {
  const profile = await verifyMstructProfile(candidate, identity);
  return { profile, config: parseProfileConfig(profile.files) };
}
