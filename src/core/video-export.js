import { buildPlaybackPlan, buildMstructtimePlaybackPlan } from "./mstruct-playback.js";

export const VIDEO_EXPORT = Object.freeze({ width: 1920, height: 1080, fps: 30, sampleRate: 48000, channels: 2 });

/** Use the same route and offsets as preview; the encoder owns only frame timing. */
export function createVideoExportPlan(result, metadata, playback = {}) {
  const offset = (playback.userOffset ?? 0) + (playback.temporaryOffset ?? 0);
  const plan = metadata.isStableTempo
    ? buildPlaybackPlan(result, offset + (Number(metadata.offset) || 0))
    : buildMstructtimePlaybackPlan(result, playback.timelineDocument, offset);
  if (!result?.ok || !plan.ready || plan.durationMs <= 0) throw new Error("videoPlaybackUnavailable");
  const durationMs = Math.max(plan.durationMs, Number(playback.bgmDurationMs) || 0);
  if (!Number.isFinite(durationMs) || durationMs > 6 * 60 * 60 * 1000) throw new Error("videoTooLong");
  return { ...VIDEO_EXPORT, plan, durationMs, frameCount: Math.ceil(durationMs * VIDEO_EXPORT.fps / 1000) };
}

export function pianoExportEvents(plan) {
  const seen = new Set();
  return plan.entries.flatMap(entry => {
    const key = entry.pianoAttackRouteIndex;
    if (!entry.midiNotes?.length || seen.has(key) || entry.pianoEndMs <= 0) return [];
    seen.add(key);
    const startMs = Math.max(0, entry.startMs), endMs = entry.pianoEndMs;
    return endMs > startMs ? [{ startMs, endMs, notes: entry.midiNotes }] : [];
  });
}
