import { verifyMstructProfile } from "../core/profile.js";
import { readProfileIdentity, parseProfileId, isProfileHash, MstructProfileError } from "../core/profile-schema.js";
import { assignDocumentProfile } from "../core/profile-document.js";
import { rebindDocumentProfile } from "../core/profile-rebind.js";
import { parseMstructDocument } from "../core/mstruct-document.js";

const key = (identity) => JSON.stringify([identity.profileId, identity.bundleHash]);
export function validateProfileIndex(input) {
  if (!input || !Array.isArray(input.lines) || input.lines.length > 1000) throw new MstructProfileError("profile-manifest-unsupported");
  const seen = new Set();
  const lines = input.lines.map((line) => {
    const { version } = parseProfileId(line.profileId);
    if (seen.has(line.profileId) || line.version !== version || !isProfileHash(line.currentHash)
      || (line.finalHash && !isProfileHash(line.finalHash))) throw new MstructProfileError("profile-identity-mismatch");
    seen.add(line.profileId);
    return { profileId: line.profileId, version, currentHash: line.currentHash, finalHash: line.finalHash ?? null,
      deprecatedAt: line.deprecatedAt ?? null, lockedAt: line.lockedAt ?? null };
  });
  const pointer = input.default;
  if (pointer && (!isProfileHash(pointer.bundleHash) || !seen.has(pointer.profileId))) throw new MstructProfileError("profile-identity-mismatch");
  return { lines, default: pointer ? { profileId: pointer.profileId, bundleHash: pointer.bundleHash } : null };
}

/** Both native I/O and the embedded baseline are injected; no platform globals. */
export function createStandaloneProfiles({ platform, embeddedProfile, authoringAppVersion }) {
  const cache = new Map();
  let state = { url: "", index: null, installed: [] }, selected = null, baseline;
  const ready = (async () => {
    baseline = await verifyMstructProfile(await embeddedProfile());
    cache.set(key(baseline.manifest), baseline);
    if (platform) {
      try {
        state = await platform.profileState();
        try { state.index = state.index ? validateProfileIndex(state.index) : null; } catch { state.index = null; }
        const installed = [];
        for (const manifest of state.installed ?? []) {
          try { const profile = await verifyMstructProfile(await platform.profileGet(manifest), { ...manifest, formatVersion: 1 }); cache.set(key(manifest), profile); installed.push(profile.manifest); } catch { /* Damaged cache entries never claim verified installation. */ }
        }
        state.installed = installed;
        await platform.profilePut(baseline);
      } catch { state = { url: "", index: null, installed: [] }; }
    }
  })();
  async function install(candidate, identity) {
    const verified = await verifyMstructProfile(candidate, identity ?? null);
    if (platform) await platform.profilePut(verified);
    cache.set(key(verified.manifest), verified);
    state.installed = [...state.installed.filter((item) => key(item) !== key(verified.manifest)), verified.manifest];
    return verified;
  }
  async function resolve(identity, { download = true } = {}) {
    await ready;
    if (cache.has(key(identity))) return verifyMstructProfile(cache.get(key(identity)), identity);
    const local = await platform?.profileGet(identity);
    if (local) {
      const verified = await verifyMstructProfile(local, identity);
      cache.set(key(identity), verified);
      return verified;
    }
    if (download && platform && state.url) return install(await platform.profileFetch(identity), identity);
    throw new MstructProfileError("profile-missing", identity);
  }
  async function resolveForEditing(identity) {
    const current = state.index?.lines.find((line) => line.profileId === identity.profileId);
    const preferred = current ? { ...identity, bundleHash: current.currentHash } : null;
    const candidates = new Map([preferred, baseline.manifest, identity, ...[...cache.values()].map((p) => p.manifest)]
      .filter((item) => item?.profileId === identity.profileId && item.formatVersion === identity.formatVersion)
      .map((item) => [key(item), item]));
    // A version line promises compatibility. Prefer verified local rules so a closed
    // registry or a missing historical hash cannot prevent offline authoring.
    for (const candidate of candidates.values()) {
      try { return await resolve(candidate, { download: false }); } catch { /* Try another complete local build in this version line. */ }
    }
    if (current) {
      try { return await resolve(preferred); } catch { /* The exact requested build may still be downloadable. */ }
    }
    return resolve(identity);
  }
  return {
    ready, resolve, install,
    async resolveForIndex(identity) {
      try { return await resolve(identity); }
      catch { return resolveForEditing(identity); }
    },
    async state() { await ready; return { ...state, installed: [...new Map([baseline.manifest, ...state.installed, ...[...cache.values()].map((p) => p.manifest)].map((m) => [key(m), m])).values()] }; },
    async configure(url) { await ready; await platform.profileConfigure(url); const saved = await platform.profileState(); state.url = saved.url; state.index = saved.index ? validateProfileIndex(saved.index) : null; },
    async refresh() { await ready; const index = validateProfileIndex(await platform.profileFetch()); await platform.profileSaveIndex(index); state.index = index; return index; },
    async import() { await ready; const candidate = await platform.profileImport(); return candidate ? install(candidate) : null; },
    async select(identity) { const profile = await resolve({ ...identity, formatVersion: 1 }); selected = profile.manifest; return profile; },
    async recommended() {
      await ready;
      if (selected) return resolve({ ...selected, formatVersion: 1 });
      const pointer = state.index?.default;
      if (pointer) {
        try { return await resolve({ ...pointer, formatVersion: 1 }); } catch { /* New offline documents can use the embedded formal baseline. */ }
      }
      return baseline;
    },
    async prepareOpen(source) {
      await ready;
      const document = parseMstructDocument(source);
      if (!document.ok) return { source, error: { code: "profile-assignment-required" } };
      let identity;
      try {
        identity = readProfileIdentity(document.metadata);
        if (!identity) return { source, assignmentRequired: true };
        const target = await resolveForEditing(identity);
        if (target.manifest.bundleHash !== identity.bundleHash) {
          // A same-version rules refresh is runtime preparation, not a user edit.
          return { source: rebindDocumentProfile(source, target).source, changed: false, rulesUpdated: true };
        }
        return { source, changed: false };
      } catch (error) { return { source, error: error.code ? error : new MstructProfileError("profile-missing", identity ?? {}) }; }
    },
    async assign(source, candidate) { return assignDocumentProfile(source, candidate ?? await this.recommended(), authoringAppVersion); },
  };
}
