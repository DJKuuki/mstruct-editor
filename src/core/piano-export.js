import { pianoExportEvents, VIDEO_EXPORT } from "./video-export.js";

/** Bounded offline chunks, using the same smplr instrument, samples and velocity. */
export async function createPianoExport(plan, instrumentUrl) {
  const { Instrument, Scheduler, soundfontToPreset } = await import("smplr");
  const response = await fetch(instrumentUrl);
  if (!response.ok) throw new Error("videoPianoFailed");
  const text = await response.text();
  const marker = "MIDI.Soundfont.acoustic_grand_piano =";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("videoPianoFailed");
  const samples = JSON.parse(text.slice(text.indexOf("{", start), text.lastIndexOf("}") + 1).replace(/,\s*}$/, "}"));
  const decoder = new OfflineAudioContext(2, 1, VIDEO_EXPORT.sampleRate);
  const buffers = new Map();
  await Promise.all(Object.entries(samples).map(async ([name, source]) => {
    const bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), character => character.charCodeAt(0));
    buffers.set(name, await decoder.decodeAudioData(bytes.buffer));
  }));
  const preset = soundfontToPreset([...buffers.keys()]);
  // Soundfont does not loop samples by default. Earlier attacks are silent once
  // the longest pitched sample has ended; this makes chunk boundaries seamless.
  const warmup = Math.max(...[...buffers.values()].map(buffer => buffer.duration)) * 2 + 0.4;
  const events = pianoExportEvents(plan);
  const Piano = Instrument((context, _options, sampler) => {
    const gain = context.createGain();
    gain.gain.value = 5;
    sampler.output.addInsert(gain);
    return sampler.loadInstrument(preset, buffers);
  });
  return async (startFrame, frameCount) => {
    const startSeconds = startFrame / VIDEO_EXPORT.sampleRate;
    const origin = Math.max(0, startSeconds - warmup);
    const skip = Math.round((startSeconds - origin) * VIDEO_EXPORT.sampleRate);
    const context = new OfflineAudioContext(2, skip + frameCount, VIDEO_EXPORT.sampleRate);
    // Dispatch every note into Web Audio before offline rendering starts.
    // The realtime scheduler's default 200ms lookahead would lose later notes.
    const scheduler = Scheduler(context, { lookaheadMs: (skip + frameCount) / VIDEO_EXPORT.sampleRate * 1000 + 1000 });
    const piano = Piano(context, { volume: 82, scheduler });
    await piano.ready;
    for (const event of events) {
      if (event.startMs / 1000 < origin || event.startMs / 1000 >= (startFrame + frameCount) / VIDEO_EXPORT.sampleRate) continue;
      for (const note of event.notes) piano.start({ note, velocity: 88, time: event.startMs / 1000 - origin, duration: (event.endMs - event.startMs) / 1000 });
    }
    try {
      const buffer = await context.startRendering();
      const pcm = new Float32Array(frameCount * 2);
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      for (let frame = 0; frame < frameCount; frame++) {
        pcm[frame * 2] = left[skip + frame]; pcm[frame * 2 + 1] = right[skip + frame];
      }
      return pcm;
    } finally { piano.dispose(); scheduler.stop(); }
  };
}
