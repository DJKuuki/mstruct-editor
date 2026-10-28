export const CHORD_QUALITY_DISPLAY_OPTIONS = Object.freeze({
  diminishedDisplay: Object.freeze(["dim", "o"]),
  augmentedDisplay: Object.freeze(["aug", "+"]),
  majorSeventhDisplay: Object.freeze(["M", "ma", "maj", "triangle"]),
  minorDisplay: Object.freeze(["m", "mi"]),
});

export function normalizeChordQualityPreferences(value) {
  return Object.fromEntries(Object.entries(CHORD_QUALITY_DISPLAY_OPTIONS).map(([key, values]) => [
    key, values.includes(value?.[key]) ? value[key] : values[0],
  ]));
}

/** Only compiled quality segments are substituted; names, special tokens and intervals remain intact. */
export function displayChordQuality(part, mode, preferences = {}) {
  const options = normalizeChordQualityPreferences(preferences);
  if (part.role === "basic-quality") {
    if (part.text === "dim") return options.diminishedDisplay === "o"
      ? { ...part, text: "o", superscript: true, superscriptStyle: "roman" }
      : part;
    if (part.text === "aug") return { ...part, text: options.augmentedDisplay };
    if (part.text === "m") return { ...part, text: options.minorDisplay };
  }
  if (part.role === "tension" && part.text === "M") {
    const value = options.majorSeventhDisplay;
    return { ...part, text: value === "triangle" ? "△" : value,
      superscript: mode === "superscript" || (mode === "camel" && ["M", "triangle"].includes(value)) };
  }
  return part;
}

export function hasChordQualityOverrides(preferences) {
  const options = normalizeChordQualityPreferences(preferences);
  return Object.entries(CHORD_QUALITY_DISPLAY_OPTIONS).some(([key, values]) => options[key] !== values[0]);
}
