const PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTALS = { "": 0, bb: -2, b: -1, "#": 1, x: 2 };

/** Quotes preserve a provisional (Ambi) reference; they are not part of its note. */
export function parseTonalReference(value, { query = false, extendedAccidentals = false } = {}) {
  if (typeof value !== "string") return null;
  const quoted = /^"([^"]+)"$/.exec(value);
  const ambiguous = Boolean(quoted);
  const note = quoted ? quoted[1] : value;
  const pattern = extendedAccidentals ? /^[A-Ga-g](?:bb|b|#|x)?$/ : /^[A-Ga-g](?:#|b)?$/;
  if (pattern.test(note)) {
    return { value, note, ambiguous, kind: "note", mode: note[0] === note[0].toLowerCase() ? "m" : "M" };
  }
  if (query && ["*", "M", "m"].includes(note)) {
    return { value, note, ambiguous, kind: note === "*" ? "any" : "mode", mode: note === "*" ? null : note };
  }
  return null;
}

export function tonalReferenceMode(value) {
  return parseTonalReference(value, { extendedAccidentals: true })?.mode ?? null;
}

export function tonalReferencePath(value) {
  return parseTonalReference(value, { extendedAccidentals: true })?.note ?? value;
}

export function tonalReferencePitchClass(value) {
  const reference = parseTonalReference(value, { extendedAccidentals: true });
  if (!reference) return null;
  const { note } = reference;
  return ((PITCH_CLASSES[note[0].toUpperCase()] + ACCIDENTALS[note.slice(1)]) % 12 + 12) % 12;
}

export function tonalReferenceModeKey(value) {
  const reference = parseTonalReference(value, { extendedAccidentals: true });
  return reference ? reference.ambiguous ? `"${reference.mode}"` : reference.mode : null;
}

export function matchTonalReference(pattern, value) {
  const constraint = parseTonalReference(pattern, { query: true, extendedAccidentals: true });
  const reference = parseTonalReference(value, { extendedAccidentals: true });
  if (!constraint || !reference || constraint.ambiguous !== reference.ambiguous) return false;
  return constraint.kind === "any" || (constraint.kind === "mode"
    ? constraint.mode === reference.mode : constraint.note === reference.note);
}
