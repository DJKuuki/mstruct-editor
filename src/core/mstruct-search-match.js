import { activeMstructSearchTags } from "./mstruct-search-events.js";
import { matchDtcPair } from "./mstruct-dtc.js";
import { positiveFieldPattern } from "./mstruct-search-exclusion.js";
import { chordSetOffsets, chordSetVariantMatches } from "./mstruct-search-chord.js";
import { harmonySearchViews } from "./mstruct-search-roman.js";
import { matchTonalReference, parseTonalReference, tonalReferencePath } from "./tonal-reference.js";

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function advancePatternSequence(parts, atoms, inputStates, candidateNotes = null) {
  let states = inputStates;
  const dedupe = (values) => [...new Map(values.map((state) => [`${state.atomIndex}:${state.offset ?? "_"}`, state])).values()];
  for (const part of parts) {
    const nextStates = [];
    for (const state of states) {
      if (part.kind === "choice") {
        for (const branch of part.branches) nextStates.push(...advancePatternSequence(branch, atoms, [state], candidateNotes));
      } else if (part.kind === "one") {
        if (state.atomIndex < atoms.length) nextStates.push({ ...state, atomIndex: state.atomIndex + 1 });
      } else if (part.kind === "many" || part.kind === "many1") {
        const first = part.kind === "many1" ? state.atomIndex + 1 : state.atomIndex;
        for (let next = first; next <= atoms.length; next += 1) nextStates.push({ ...state, atomIndex: next });
      } else if (part.kind === "relative") {
        const note = candidateNotes?.get(state.atomIndex);
        if (!note) continue;
        const offset = modulo(note.pitchClass - modulo(part.value, 12), 12);
        if (state.offset === null || state.offset === offset) nextStates.push({ atomIndex: state.atomIndex + 1, offset });
      } else {
        let joined = "";
        for (let next = state.atomIndex; next < atoms.length; next += 1) {
          joined += atoms[next];
          if (joined === part.value) nextStates.push({ ...state, atomIndex: next + 1 });
          if (joined.length >= part.value.length) break;
        }
      }
    }
    states = dedupe(nextStates);
    if (!states.length) break;
  }
  return states;
}

function matchWildcardParts(parts, atoms) {
  return advancePatternSequence(parts, atoms, [{ atomIndex: 0, offset: null }])
    .some((state) => state.atomIndex === atoms.length);
}

function matchingFieldAlternatives(pattern, field, options = {}) {
  if (pattern.kind === "exclude") {
    const alternatives = matchingFieldAlternatives(pattern.include, field, options);
    return alternatives.length && passesFieldExclusion(pattern, field, options) ? alternatives : [];
  }
  if (pattern.kind === "placeholder") return field.type === "placeholder" ? [null] : [];
  if (!["normal", "missing"].includes(field.type)) return [];
  const alternatives = field.type === "missing" ? [{ atoms: [] }] : field.alternatives;
  if (pattern.kind === "chord-set") return alternatives.filter((alternative) => pattern.sources.includes(alternative.source)
    || pattern.variants.some((variant) => chordSetVariantMatches(variant, alternative.pitchSet)));
  if (pattern.kind === "note-set") return alternatives.filter((alternative) => pattern.masks.includes(alternative.pitchSet?.[2])
    && (pattern.root.kind === "any" || pattern.root.kind === "relative" || alternative.pitchSet?.[0] === pattern.root.value));
  if (pattern.kind === "source") return alternatives.filter((alternative) => harmonySearchViews(alternative).some((view) => view.source === pattern.source));
  if (pattern.kind === "atoms") return alternatives.filter((alternative) => harmonySearchViews(alternative).some((view) => arraysEqual(pattern.atoms, view.atoms)));
  return alternatives.filter((alternative) => harmonySearchViews(alternative).some((view) => (!pattern.hasRelative && matchWildcardParts(
    pattern.parts,
    pattern.listAware ? view.atoms : view.atoms.filter((atom) => !["(", ")", ","].includes(atom)),
  ))));
}

function matchField(pattern, field, options) {
  return matchingFieldAlternatives(pattern, field, options).length > 0;
}

function passesFieldExclusion(pattern, field, options) {
  return pattern.kind !== "exclude" || (field.type === "normal"
    && !pattern.exclude.some((branch) => matchField(branch, field, options)));
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function relativeAlternativeOffset(pattern, alternative) {
  if (pattern.atoms.length !== alternative.atoms.length) return null;
  const notes = new Map((alternative.notes ?? []).map((note) => [note.atomIndex, note]));
  let offset = null;
  for (const [index, part] of pattern.atoms.entries()) {
    if (part.kind === "literal") {
      if (part.value !== alternative.atoms[index]) return null;
      continue;
    }
    const note = notes.get(index);
    if (!note) return null;
    const current = modulo(note.pitchClass - modulo(part.value, 12), 12);
    if (offset !== null && current !== offset) return null;
    offset = current;
  }
  return offset;
}

function matchingRelativeOffsets(pattern, field, allowedOffsets) {
  if (field.type !== "normal") return [];
  const offsets = field.alternatives.map((alternative) => relativeAlternativeOffset(pattern, alternative))
    .filter((value) => value !== null);
  const unique = [...new Set(offsets)];
  if (allowedOffsets === null) return unique;
  const allowed = new Set(allowedOffsets);
  return unique.filter((offset) => allowed.has(offset));
}

function matchingNoteSetOffsets(pattern, field, allowedOffsets) {
  if (field.type !== "normal") return [];
  const offsets = field.alternatives
    .filter((alternative) => pattern.masks.includes(alternative.pitchSet?.[2])
      && alternative.pitchSet?.[1] !== null && alternative.pitchSet?.[1] !== undefined)
    .map((alternative) => modulo(alternative.pitchSet[1] - modulo(pattern.root.value, 12), 12));
  const unique = [...new Set(offsets)];
  if (allowedOffsets === null) return unique;
  const allowed = new Set(allowedOffsets);
  return unique.filter((offset) => allowed.has(offset));
}

function relativeWildcardOffsets(pattern, alternative, allowedOffsets) {
  const atoms = pattern.listAware ? alternative.atoms : alternative.atoms.filter((atom) => !["(", ")", ","].includes(atom));
  const candidateNotes = new Map();
  for (const note of alternative.notes ?? []) {
    const filteredIndex = pattern.listAware
      ? note.atomIndex
      : alternative.atoms.slice(0, note.atomIndex).filter((atom) => !["(", ")", ","].includes(atom)).length;
    candidateNotes.set(filteredIndex, note);
  }
  const allowed = allowedOffsets === null ? null : new Set(allowedOffsets);
  const states = advancePatternSequence(pattern.parts, atoms, [{ atomIndex: 0, offset: null }], candidateNotes);
  return [...new Set(states
    .filter((state) => state.atomIndex === atoms.length && state.offset !== null && (!allowed || allowed.has(state.offset)))
    .map((state) => state.offset))];
}

function matchSequenceItems(pattern, values) {
  const memo = new Map();
  function visit(patternIndex, valueIndex) {
    const key = `${patternIndex}:${valueIndex}`;
    if (memo.has(key)) return memo.get(key);
    if (patternIndex === pattern.length) return valueIndex === values.length;
    const item = pattern[patternIndex];
    let matched = false;
    if (item.kind === "many1") {
      for (let next = valueIndex + 1; next <= values.length && !matched; next += 1) matched = visit(patternIndex + 1, next);
    } else if (item.kind === "one") {
      matched = valueIndex < values.length && visit(patternIndex + 1, valueIndex + 1);
    } else if (item.kind === "exact") {
      matched = values[valueIndex] === item.value && visit(patternIndex + 1, valueIndex + 1);
    } else if (item.kind === "family") {
      matched = item.values.includes(values[valueIndex]) && visit(patternIndex + 1, valueIndex + 1);
    }
    memo.set(key, matched);
    return matched;
  }
  return visit(0, 0);
}

function matchTag(constraint, tag) {
  if (constraint.kind === "choice") return constraint.branches.some((branch) => matchTag(branch, tag));
  if (constraint.kind === "dtc-pair") return matchDtcPair(constraint.values, tag.token);
  if (constraint.kind === "exact") return tag.token === constraint.token;
  if (constraint.kind === "sequence-pattern") {
    const match = new RegExp(`^<${constraint.family}:([^>]*)>$`).exec(tag.token);
    return Boolean(match && matchSequenceItems(constraint.items, match[1].split(",")));
  }
  if (constraint.family === "Centricity" && tag.token.startsWith(constraint.prefix)) {
    const reference = parseTonalReference(tag.token.slice(constraint.prefix.length, -1), { extendedAccidentals: true });
    return Boolean(reference && reference.ambiguous === constraint.ambiguous);
  }
  return tag.token.startsWith(constraint.prefix) && tag.token.endsWith(">");
}

function matchTags(constraints, tags) {
  return constraints.every((constraint) => tags.some((tag) => matchTag(constraint, tag)));
}

function matchTonalCenter(constraint, values, tonalCenterNone = false) {
  if (!constraint) return true;
  if (constraint.kind === "choice") return constraint.branches.some((branch) => matchTonalCenter(branch, values, tonalCenterNone));
  if (constraint.value === "None") return tonalCenterNone;
  return values.some((value) => matchTonalReference(constraint.value, value));
}

function matchTimeSignature(constraint, value) {
  if (!constraint) return true;
  if (constraint.kind === "choice") return constraint.branches.some((branch) => matchTimeSignature(branch, value));
  if (constraint.value === "*") return Boolean(value);
  if (constraint.value === "adlib") return value === "adlib";
  if (!value || value === "adlib") return false;
  const [wantedNumerator, wantedDenominator] = constraint.value.split("/");
  const [numerator, denominator] = value.split("/");
  return (wantedNumerator === "*" || wantedNumerator === numerator)
    && (wantedDenominator === "*" || wantedDenominator === denominator);
}

function matchModulation(constraint, value) {
  if (!constraint) return true;
  if (!value || value.type !== constraint.type) return false;
  return matchTonalReference(constraint.target, value.target)
    && (constraint.relation === "*" || constraint.relation === value.relation);
}

function matchFractionPattern(numerator, denominator, value) {
  const [actualNumerator, actualDenominator] = String(value ?? "").split("/");
  return (numerator === "*" || numerator === actualNumerator)
    && (denominator === "*" || denominator === actualDenominator);
}

function matchMetricModulation(constraint, values) {
  if (!constraint) return true;
  if (constraint.kind === "choice") return constraint.branches.some((branch) => matchMetricModulation(branch, values));
  if (constraint.any) return values.length > 0;
  return values.some((value) => matchFractionPattern(constraint.fromNumerator, constraint.fromDenominator, value.from)
    && matchFractionPattern(constraint.toNumerator, constraint.toDenominator, value.to));
}

function matchBpm(constraint, values) {
  if (!constraint) return true;
  if (constraint.kind === "choice") return constraint.branches.some((branch) => matchBpm(branch, values));
  if (constraint.any) return values.length > 0;
  return values.some((value) => {
    const [numerator, denominator] = String(value.beat ?? "").split("/");
    if (constraint.beatNumerator !== "*" && constraint.beatNumerator !== numerator) return false;
    if (constraint.beatDenominator !== "*" && constraint.beatDenominator !== denominator) return false;
    if (constraint.tempo.kind === "any") return true;
    if (constraint.tempo.kind === "exact") return value.tempo === constraint.tempo.value;
    return value.tempo >= constraint.tempo.minimum && value.tempo <= constraint.tempo.maximum;
  });
}

function matchNewRiemannian(constraint, value) {
  if (!constraint) return true;
  if (!value) return false;
  if (constraint.kind === "choice") return constraint.branches.some((branch) => matchNewRiemannian(branch, value));
  if (constraint.kind === "any") return true;
  if (constraint.kind === "exact") return constraint.value === value;
  return /^[PLR]{1,6}$/.test(value) && matchWildcardParts(constraint.parts, [...value]);
}

function isUnrestrictedField(pattern) {
  pattern = positiveFieldPattern(pattern);
  return pattern?.kind === "wildcard"
    && pattern.parts.length === 1
    && pattern.parts[0].kind === "many";
}

function matchingTonalCenters(constraint, values, tonalCenterNone = false) {
  if (!constraint) return null;
  return values.filter((value) => matchTonalCenter(constraint, [value], tonalCenterNone));
}

function intersectTonalCenters(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function resetsRomanPath(event) {
  return ["placeholder", "no-chord", "cluster", "white-key-cluster", "black-key-cluster"].includes(event.kind)
    || event.roman.type === "placeholder";
}

function matchQueryEvent(queryEvent, event, relativeOffsets = null, queryOptions = {}, globalTags = []) {
  if (!matchTags(queryEvent.tags, activeMstructSearchTags(event, globalTags))) return null;
  if (!matchTonalCenter(queryEvent.tonalCenter, event.tonalCenters, event.tonalCenterNone === true)) return null;
  if (!matchTimeSignature(queryEvent.timeSignature, event.timeSignature)) return null;
  if (!matchModulation(queryEvent.modulation, event.modulation)) return null;
  if (!matchMetricModulation(queryEvent.metricModulation, event.metricModulations ?? [])) return null;
  if (!matchBpm(queryEvent.bpm, event.bpms ?? [])) return null;
  if (!matchNewRiemannian(queryEvent.newRiemannian, event.newRiemannian ?? null)) return null;

  if (queryEvent.harmony?.special) {
    return event.kind === queryEvent.harmony.special ? { tonalCenters: null, resetsRomanPath: resetsRomanPath(event) } : null;
  }
  if (event.kind !== "harmony") return null;
  if (!queryEvent.harmony) return { tonalCenters: null, resetsRomanPath: resetsRomanPath(event) };

  let nextRelativeOffsets = null;
  const chordPattern = positiveFieldPattern(queryEvent.harmony.chord);
  if (chordPattern.kind === "chord-set" && chordPattern.hasRelative) {
    nextRelativeOffsets = chordSetOffsets(chordPattern, event.chord, relativeOffsets);
    if (!nextRelativeOffsets.length) return null;
  } else if (chordPattern.kind === "note-set" && chordPattern.root.kind === "relative") {
    nextRelativeOffsets = matchingNoteSetOffsets(chordPattern, event.chord, relativeOffsets);
    if (!nextRelativeOffsets.length) return null;
  } else if (["relative-atoms", "relative-wildcard"].includes(chordPattern.kind)
    || (chordPattern.kind === "choice-pattern" && chordPattern.hasRelative)) {
    nextRelativeOffsets = chordPattern.kind === "relative-atoms"
      ? matchingRelativeOffsets(chordPattern, event.chord, relativeOffsets)
      : (event.chord.type === "normal" ? [...new Set(event.chord.alternatives.flatMap((alternative) =>
          relativeWildcardOffsets(chordPattern, alternative, relativeOffsets)))] : []);
    if (!nextRelativeOffsets.length) return null;
  } else if (!matchField(chordPattern, event.chord, queryOptions)) return null;
  if (!passesFieldExclusion(queryEvent.harmony.chord, event.chord, queryOptions)) return null;
  const romanAlternatives = matchingFieldAlternatives(queryEvent.harmony.roman, event.roman, queryOptions);
  if (!romanAlternatives.length) return null;
  let tonalCenters = null;
  if (!isUnrestrictedField(queryEvent.harmony.roman) && queryEvent.harmony.roman.kind !== "placeholder") {
    const romanTonalCenters = [...new Set(romanAlternatives.map((alternative) => alternative?.tonalCenter).filter(Boolean))];
    if (romanTonalCenters.length) {
      const constrainedTonalCenters = matchingTonalCenters(queryEvent.tonalCenter, event.tonalCenters, event.tonalCenterNone === true);
      tonalCenters = constrainedTonalCenters === null
        ? romanTonalCenters
        : intersectTonalCenters(constrainedTonalCenters, romanTonalCenters);
      if (!tonalCenters.length) return null;
      // Explicit TC conditions bind the exact layer above; continuous Roman
      // paths use the underlying note and mode across certainty changes.
      tonalCenters = [...new Set(tonalCenters.map(tonalReferencePath))];
    }
  }
  return { tonalCenters, relativeOffsets: nextRelativeOffsets, resetsRomanPath: resetsRomanPath(event) };
}

function isAlwaysTransparent(event, queryEvent, queryOptions) {
  if (event.continuation) return true;
  if (event.secondary && !queryOptions.notIgnoreSecondary) return true;
  return event.kind === "rest" && queryEvent.harmony?.special !== "rest";
}

function globalTagsMatch(constraints, tags) {
  return constraints.every((constraint) => tags.some((tag) => matchTag(constraint, tag)));
}

function makeWindow(events, matchedPositions, matchedCursors, segmentPositions) {
  const first = matchedPositions[0];
  const last = matchedPositions.at(-1);
  const spanEvents = segmentPositions
    .slice(matchedCursors[0], matchedCursors.at(-1) + 1)
    .map((position) => events[position]);
  return {
    startPosition: first,
    endPosition: last,
    eventIds: spanEvents.map((event) => event.id),
    matchedEventIds: matchedPositions.map((position) => events[position].id),
    startSource: events[first].source.start,
    endSource: events[last].source.end,
    target: events[first].source,
  };
}

function queryEventBranches(queryEvent) {
  return queryEvent?.kind === "choice" ? queryEvent.branches : [queryEvent];
}

function advanceQueryState(state, queryEvent, projection, segmentPositions, queryOptions) {
  let cursor = state.cursor;
  while (cursor < segmentPositions.length) {
    const eventPosition = segmentPositions[cursor];
    const event = projection.events[eventPosition];
    if (isAlwaysTransparent(event, queryEvent, queryOptions)) {
      cursor += 1;
      continue;
    }
    const eventMatch = matchQueryEvent(queryEvent, event, state.relativeOffsets, queryOptions, projection.globalTags ?? []);
    if (!eventMatch) return null;
    let tonalPath = state.tonalPath;
    if (eventMatch.resetsRomanPath) tonalPath = null;
    else if (eventMatch.tonalCenters !== null) {
      tonalPath = tonalPath === null
        ? eventMatch.tonalCenters
        : intersectTonalCenters(tonalPath, eventMatch.tonalCenters);
      if (!tonalPath.length) return null;
    }
    return {
      cursor: cursor + 1,
      matchedPositions: [...state.matchedPositions, eventPosition],
      matchedCursors: [...state.matchedCursors, cursor],
      tonalPath,
      relativeOffsets: eventMatch.relativeOffsets !== null && eventMatch.relativeOffsets !== undefined
        ? eventMatch.relativeOffsets
        : state.relativeOffsets,
    };
  }
  return null;
}

function searchStateKey(state) {
  return [
    state.cursor,
    state.matchedPositions.join(":"),
    state.matchedCursors.join(":"),
    state.tonalPath === null ? "_" : [...state.tonalPath].sort().join("|"),
    state.relativeOffsets === null ? "_" : [...state.relativeOffsets].sort((left, right) => left - right).join("|"),
  ].join(";");
}

export function matchMstructSearchQuery(query, projection) {
  if (!query?.ok) throw new TypeError("Cannot match an invalid MStruct search query.");
  if (!projection?.events || !projection?.segments) throw new TypeError("A projected MStruct search event stream is required.");
  if (!query.events.length || !globalTagsMatch(query.options.globalTags, projection.globalTags ?? [])) return { windows: [] };

  const windows = [];
  const seen = new Set();
  for (const segmentPositions of projection.segments) {
    if (!segmentPositions.length) continue;
    for (let candidateStart = 0; candidateStart < segmentPositions.length; candidateStart += 1) {
      let states = [{ cursor: candidateStart, matchedPositions: [], matchedCursors: [], tonalPath: null, relativeOffsets: null }];
      for (const queryEvent of query.events) {
        const next = [];
        for (const state of states) {
          for (const branch of queryEventBranches(queryEvent)) {
            const advanced = advanceQueryState(state, branch, projection, segmentPositions, query.options);
            if (advanced) next.push(advanced);
          }
        }
        states = [...new Map(next.map((state) => [searchStateKey(state), state])).values()];
        if (!states.length) break;
      }
      for (const state of states) {
        if (!state.matchedPositions.length) continue;
        const key = state.matchedPositions.map((position) => projection.events[position].id).join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        windows.push(makeWindow(projection.events, state.matchedPositions, state.matchedCursors, segmentPositions));
      }
    }
  }
  return { windows };
}
