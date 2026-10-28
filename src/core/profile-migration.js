import { parseMstructDocument } from "./mstruct-document.js";
import { assignDocumentProfile, compileProfileDocument } from "./profile-document.js";
import { readProfileIdentity } from "./profile-schema.js";
import { canonicalJson } from "./profile.js";
import { projectMstructSearchEvents } from "./mstruct-search-events.js";
import { buildPlaybackPlan } from "./mstruct-playback.js";
import { compareMstructProfiles } from "./profile-diff.js";

/** Compare shared compiler output, musical timing and MIDI notes, not host guesses. */
function structure(result) {
  const playback = buildPlaybackPlan(result);
  return { search: projectMstructSearchEvents(result, { globalTags: result.globalTags }),
    playback: { ready: playback.ready, durationMs: playback.durationMs, entries: playback.entries.map((entry) => ({
      kind: entry.kind, startMs: entry.startMs, endMs: entry.endMs, midiNotes: entry.midiNotes, bpm: entry.bpm,
      timeSignatureLabel: entry.timeSignatureLabel,
    })) } };
}

export async function reportDocumentProfileMigration(source, target, resolveProfile) {
  const assigned = await assignDocumentProfile(source, target);
  if (!assigned.ok) return { ok: false, structureStatus: "failed", errors: assigned.errors, oldErrors: [] };
  const next = compileProfileDocument(assigned.document, assigned.profile);
  const previous = parseMstructDocument(source);
  let oldErrors = [], structureStatus = "unknown";
  try {
    const identity = readProfileIdentity(previous.metadata);
    if (identity) {
      const old = compileProfileDocument(previous, await resolveProfile(identity));
      if (old.ok) structureStatus = canonicalJson(structure(old)) === canonicalJson(structure(next)) ? "same" : "changed";
      else oldErrors = old.errors;
    }
  } catch (error) { oldErrors = [{ code: error.code ?? "profile-missing", details: error.details }]; }
  return { ok: true, structureStatus, errors: [], oldErrors, source: assigned.source, result: next };
}

/** Editing may adopt an additive/display build in the same visible series.
 * Reading/history always use exact resolution; hosts persist only a draft here.
 */
export async function prepareCompatibleProfileUpgrade(source, target, resolveProfile) {
  const unchanged = { upgraded: false, source };
  const document = parseMstructDocument(source);
  if (!document.ok) return unchanged;
  const identity = readProfileIdentity(document.metadata);
  if (!identity || identity.profileId !== target.manifest.profileId
    || identity.formatVersion !== target.manifest.formatVersion
    || identity.bundleHash === target.manifest.bundleHash) return unchanged;
  const previous = await resolveProfile(identity);
  const diff = await compareMstructProfiles(previous, target);
  if (!diff.semanticCompatible || !diff.authoringCompatible) return unchanged;
  const report = await reportDocumentProfileMigration(source, target, resolveProfile);
  return report.ok && report.structureStatus === "same"
    ? { upgraded: true, source: report.source } : unchanged;
}
