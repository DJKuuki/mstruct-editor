// Versioned, unmodified Musyng Kite asset; shared core stays host-agnostic.
export const WEB_PIANO_PATH = "soundfonts/acoustic-grand-piano-54680c0289541f06-ogg.js";

export function webPianoOptions(baseUrl) {
  return { instrumentUrl: new URL(WEB_PIANO_PATH, baseUrl).href };
}
