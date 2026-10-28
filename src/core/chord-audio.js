export class ChordPianoPlayer {
  constructor(options = {}) {
    this.instrument = options.instrument ?? "acoustic_grand_piano";
    this.instrumentUrl = options.instrumentUrl ?? "";
    this.volume = options.volume ?? 82;
    this.context = null;
    this.piano = null;
    this.loadingPromise = null;
  }

  get loaded() {
    return Boolean(this.piano && !this.loadingPromise);
  }

  async load() {
    const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable.");

    if (!this.context) this.context = new AudioContextConstructor();
    await this.context.resume();
    if (this.loaded) return;
    if (!this.loadingPromise) {
      const context = this.context;
      this.loadingPromise = (async () => {
        const { Soundfont } = await import("smplr");
        const pianoOptions = { volume: this.volume };
        if (this.instrumentUrl) pianoOptions.instrumentUrl = this.instrumentUrl;
        else pianoOptions.instrument = this.instrument;
        const piano = Soundfont(context, pianoOptions);
        this.piano = piano;
        try {
          await piano.ready;
        } catch (error) {
          piano.dispose();
          if (this.piano === piano) this.piano = null;
          throw error;
        }
      })().finally(() => {
        this.loadingPromise = null;
      });
    }
    await this.loadingPromise;
  }

  stop() {
    this.piano?.stop();
  }

  async play(midiNotes, { durationSeconds = 1.7 } = {}) {
    if (!Array.isArray(midiNotes) || midiNotes.some((note) => !Number.isInteger(note) || note < 0 || note > 127)) {
      throw new TypeError("MIDI notes must be integers from 0 to 127.");
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new TypeError("Piano duration must be a positive number of seconds.");
    }
    await this.load();
    this.stop();
    const time = this.context.currentTime + 0.025;
    for (const note of midiNotes) this.piano.start({ note, velocity: 88, time, duration: durationSeconds });
  }

  dispose() {
    this.stop();
    this.piano?.dispose();
    this.piano = null;
    this.loadingPromise = null;
    if (this.context) void this.context.close();
    this.context = null;
  }
}
