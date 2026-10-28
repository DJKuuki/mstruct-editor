import { parseChordSymbol } from "./chord-symbol.js";
import { embeddedOrGroups, normalizeChoiceBranches } from "./mstruct-search-choice.js";
import { tonalPitchClass } from "./mstruct-harmony.js";

const PITCH_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const modulo = (value) => ((value % 12) + 12) % 12;

/** Resolve relative source-note roles without confusing interval-list parentheses. */
export function relativeChordSource(source, offset = 0) {
  const replacements = [];
  const relatives = [];
  let noteIndex = 0;
  let cursor = 0;
  function readNoteAt(index) {
    const relative = /^\((-?\d+)\)/.exec(source.slice(index));
    if (relative) {
      const value = Number(relative[1]);
      relatives.push({ noteIndex, value, start: index, end: index + relative[0].length });
      replacements.push({ start: index, end: index + relative[0].length, value: PITCH_NAMES[modulo(value + offset)] });
      noteIndex += 1;
      return relative[0].length;
    }
    const note = /^[A-G](?:bb|b|#|x)?/.exec(source.slice(index));
    if (!note) return 0;
    noteIndex += 1;
    return note[0].length;
  }
  const firstLength = readNoteAt(0);
  if (!firstLength) return { source, relatives: [], noteCount: 0, invalid: /\(-?\d+\)/.test(source) };
  cursor = firstLength;
  while (cursor < source.length) {
    const separatorLength = source.startsWith("on", cursor) ? 2 : source[cursor] === "/" ? 1 : 0;
    const length = separatorLength ? readNoteAt(cursor + separatorLength) : 0;
    cursor += length ? separatorLength + length : 1;
  }
  let transformed = source;
  for (const replacement of replacements.reverse()) {
    transformed = transformed.slice(0, replacement.start) + replacement.value + transformed.slice(replacement.end);
  }
  return { source: transformed, relatives, noteCount: noteIndex, invalid: false };
}

function concreteSet(source, options) {
  const base = relativeChordSource(source);
  const hasRelative = base.relatives.length > 0;
  const allRelative = hasRelative && base.noteCount === base.relatives.length;
  const variants = [];
  for (let offset = 0; offset < (hasRelative && !allRelative ? 12 : 1); offset += 1) {
    try {
      const result = parseChordSymbol(offset ? relativeChordSource(source, offset).source : base.source, options);
      variants.push({
        bass: tonalPitchClass(result.structure.root),
        mask: result.structure.toPitchClassMask(),
        ...(allRelative ? { relativeBass: true } : { offset: hasRelative ? offset : null }),
      });
    } catch {
      // A fixed/relative mixture can form an invalid chord at only some offsets.
    }
  }
  if (!variants.length) return null;
  return { variants, hasRelative };
}

function concreteChoices(pattern) {
  if (["atoms", "source", "relative-atoms"].includes(pattern.kind)) return [pattern.source];
  if (pattern.kind !== "choice-pattern" || /[?*]/.test(pattern.source)) return null;
  const errors = [];
  const groups = embeddedOrGroups(pattern.source, 0, errors, { groups: 0, branches: 0 });
  // Independent groups remain a source pattern: never expand a Cartesian product.
  if (errors.length || groups.length !== 1) return null;
  const [group] = groups;
  return group.branches.map((branch) => pattern.source.slice(0, group.start) + branch.value + pattern.source.slice(group.end + 1));
}

/** Compile complete notations; wildcard and independent OR groups keep source semantics. */
export function compileChordSearchPattern(pattern, options, allowDifferentNotation) {
  if (pattern.kind === "exclude") return {
    ...pattern,
    include: compileChordSearchPattern(pattern.include, options, allowDifferentNotation),
    exclude: normalizeChoiceBranches(pattern.exclude.map((branch) => compileChordSearchPattern(branch, options, allowDifferentNotation))),
  };
  const choices = concreteChoices(pattern);
  if (!choices) return pattern;
  const variants = [];
  const sources = [];
  let hasRelative = false;
  for (const source of choices) {
    const compiled = concreteSet(source, options);
    if (!compiled) sources.push(source); // Historical unknown special tokens retain exact identity.
    else {
      variants.push(...compiled.variants);
      hasRelative ||= compiled.hasRelative;
    }
  }
  if (!allowDifferentNotation) {
    return hasRelative && !sources.length
      ? { ...pattern, anchorMasks: [...new Set(variants.map((variant) => variant.mask))].sort((a, b) => a - b) }
      : pattern;
  }
  if (!variants.length) return pattern;
  return { kind: "chord-set", variants: normalizeChoiceBranches(variants), sources: [...new Set(sources)].sort(), hasRelative };
}

export function chordSetVariantMatches(variant, pitchSet) {
  return pitchSet?.[2] === variant.mask && (variant.relativeBass || pitchSet[1] === variant.bass);
}

export function chordSetOffsets(pattern, field, allowedOffsets) {
  if (field.type !== "normal") return [];
  const offsets = new Set();
  for (const alternative of field.alternatives) {
    if (pattern.sources.includes(alternative.source)) return allowedOffsets ?? Array.from({ length: 12 }, (_, index) => index);
    for (const variant of pattern.variants) {
      if (!chordSetVariantMatches(variant, alternative.pitchSet)) continue;
      if (variant.offset === null) return allowedOffsets ?? Array.from({ length: 12 }, (_, index) => index);
      offsets.add(variant.relativeBass ? modulo(alternative.pitchSet[1] - variant.bass) : variant.offset);
    }
  }
  return [...offsets].filter((offset) => allowedOffsets === null || allowedOffsets.includes(offset));
}
