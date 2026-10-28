import { createProfileResolver } from "./profile-resolver.js";
import { MstructProfileError } from "../core/profile-schema.js";

/** Same-origin transport only; exact verification and compatibility stay shared. */
export function createHostedProfiles({ fetchJson = fetch } = {}) {
  return createProfileResolver({ resolveProfile: async (identity) => {
    const query = new URLSearchParams({ profileId: identity.profileId, hash: identity.bundleHash });
    const response = await fetchJson(`/api/mstruct-profiles?${query}`, {
      credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" },
    });
    if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) throw new MstructProfileError("profile-missing", identity);
    return response.json();
  } });
}
