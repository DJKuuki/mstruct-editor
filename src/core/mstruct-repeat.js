import { makeError } from "./mstruct-diagnostics.js";
import { addRational, equalRational, parseFraction, rational, rationalLabel, RationalRangeError } from "./mstruct-rational.js";
import { applyMetricModulationValue } from "./mstruct-tempo.js";

function sameSignature(left, right) {
  if (left === right) return true;
  if (!left || !right || left === "adlib" || right === "adlib") return false;
  return equalRational(left, right);
}

function sameNumbers(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function markerBoundaryIndex(units, unitIndex, marker) {
  const previous = units[unitIndex - 1];
  const next = units[unitIndex + 1];
  if (previous?.kind === "barline") return marker.measureIndex;
  if (next?.kind === "barline") return marker.measureIndex + 1;
  if (unitIndex === 0 && marker.kind === "repeat-start") return 0;
  return null;
}

function barNumberSetting(measure) {
  return measure.slots.flatMap((slot) => slot.settings ?? []).find((setting) => setting.type === "BN") ?? null;
}

function repeatJumpCount(marker) {
  return marker.repeatCountExplicit ? marker.repeatCount - 1 : marker.repeatCount;
}

function assignDisplayBarNumbers(measures, repeatEnds, source, errors) {
  const additions = new Map();
  for (const marker of repeatEnds) {
    if (!marker.continueBarNumbers || !Number.isInteger(marker.repeatMeasureCount)) continue;
    const amount = marker.repeatMeasureCount * repeatJumpCount(marker);
    additions.set(marker.boundaryIndex, (additions.get(marker.boundaryIndex) ?? 0) + amount);
  }

  let previousDisplay = null;
  for (const [index, measure] of measures.entries()) {
    const addition = additions.get(index) ?? 0;
    const expected = previousDisplay === null ? measure.barNumber : previousDisplay + 1 + addition;
    if (measure.explicitBarNumber && expected !== null && measure.barNumber < expected) {
      const setting = barNumberSetting(measure);
      makeError(errors, source, "bar-number-backward", setting?.start ?? measure.start, setting?.end ?? measure.end);
    }
    measure.displayBarNumber = measure.explicitBarNumber ? measure.barNumber : expected;
    previousDisplay = measure.displayBarNumber;
  }
}

function collectRepeatUnits(measures, flow) {
  const units = [];
  const measureIndexes = new Map(measures.map((measure, index) => [measure, index]));
  for (const item of flow) {
    if (item.kind === "ellipsis") {
      units.push({ kind: "ellipsis", marker: item });
      continue;
    }
    if (item.kind !== "measure") continue;
    const measure = item.measure;
    const measureIndex = measureIndexes.get(measure);
    if (!measure.complete) continue;
    for (const [slotIndex, slot] of measure.slots.entries()) {
      for (const marker of slot.markersBefore) {
        marker.measureIndex = measureIndex;
        marker.unitIndex = units.length;
        units.push({ kind: "marker", marker, measure });
      }
      units.push({ kind: "slot", slot, measure, measureIndex, slotIndex });
      for (const marker of slot.markersAfter) {
        marker.measureIndex = measureIndex;
        marker.unitIndex = units.length;
        units.push({ kind: "marker", marker, measure });
      }
    }
    if (!measure.truncatedByEllipsis) units.push({ kind: "barline", measure });
  }
  return units;
}

export function validateRepeatStructure({ measures, flow, source, errors, isStableTempo = false }) {
  const units = collectRepeatUnits(measures, flow);
  const groups = [];
  const repeatEnds = [];
  let group = null;
  let openEnding = null;
  let repeatStart = null;
  let repeatEndCount = 0;
  let repeatEndGroup = null;
  for (const unit of units) {
    if (unit.kind !== "marker") continue;
    const marker = unit.marker;
    marker.boundaryIndex = markerBoundaryIndex(units, marker.unitIndex, marker);
    if (marker.kind === "repeat-start") {
      if (repeatStart && repeatEndCount === 0) {
        makeError(errors, source, "repeat-start-nested", marker.start, marker.end);
      }
      repeatStart = marker;
      repeatEndCount = 0;
      repeatEndGroup = null;
    } else if (marker.kind === "ending-start") {
      const passes = marker.numbers ?? [];
      if (openEnding) {
        makeError(errors, source, "ending-nested", marker.start, marker.end);
      }
      if (!group || passes[0] === 1) {
        group = { entries: [], finalized: false };
        groups.push(group);
      }
      if (group?.finalized && passes[0] !== 1) {
        makeError(errors, source, "ending-after-final", marker.start, marker.end);
      }
      const previousPass = group?.entries.at(-1)?.passes.at(-1) ?? 0;
      const expected = previousPass + 1;
      if (!group || passes.some((pass, index) => pass !== expected + index)) {
        makeError(errors, source, "ending-sequence", marker.start, marker.end, { details: { expected } });
      }
      const entry = { number: passes.at(-1), passes, start: marker, end: null, reverse: null };
      group?.entries.push(entry);
      marker.group = group;
      marker.entry = entry;
      openEnding = entry;
    } else if (marker.kind === "ending-end") {
      if (!openEnding || (marker.numbers !== null && !sameNumbers(marker.numbers, openEnding.passes))) {
        makeError(errors, source, "ending-pair", marker.start, marker.end);
      } else {
        openEnding.end = marker;
        if (marker.numbers === null) group.finalized = true;
        marker.group = group;
        marker.entry = openEnding;
        openEnding = null;
      }
    } else if (marker.kind === "repeat-end") {
      repeatEnds.push(marker);
      const lastEntry = group?.entries.at(-1);
      if (lastEntry?.end && !lastEntry.reverse
        && source.slice(lastEntry.end.end, marker.start).trim() === "") {
        lastEntry.reverse = marker;
        marker.group = group;
        marker.entry = lastEntry;
      }
      if (repeatEndCount > 0 && (!marker.group || marker.group !== repeatEndGroup)) {
        makeError(errors, source, "repeat-start-reused", marker.start, marker.end);
      }
      if (repeatEndCount === 0) repeatEndGroup = marker.group ?? null;
      marker.jumpIndex = repeatStart ? repeatStart.unitIndex + 1 : 0;
      marker.jumpState = repeatStart?.savedState ?? {
        division: null, timeSignature: null, bpm: null, explicitBpm: null, bpmModulated: false,
      };
      marker.explicitStart = repeatStart;
      const expanded = marker.repeatCountExplicit || marker.continueBarNumbers;
      const startBoundary = repeatStart?.boundaryIndex ?? 0;
      if (expanded && (marker.boundaryIndex === null || repeatStart?.boundaryIndex === null
        || marker.boundaryIndex <= startBoundary)) {
        makeError(errors, source, "repeat-expanded-boundary", marker.start, marker.end);
      } else if (expanded) {
        marker.repeatMeasureCount = marker.boundaryIndex - startBoundary;
      }
      if (marker.continueBarNumbers && !isStableTempo) {
        makeError(errors, source, "repeat-continuous-bars-stable-only", marker.start, marker.end);
      }
      repeatEndCount += 1;
    }
  }
  if (openEnding) makeError(errors, source, "ending-unfinished", openEnding.start.start, openEnding.start.end);
  for (const current of groups) {
    if (!current.finalized) {
      const last = current.entries.at(-1);
      if (last) makeError(errors, source, "ending-final-close", last.start.start, last.start.end);
    }
    if (current.entries.length < 2) {
      const start = current.entries[0]?.start;
      if (start) makeError(errors, source, "ending-count", start.start, start.end);
    }
    for (const [index, entry] of current.entries.entries()) {
      if (!entry.end) continue;
      entry.start.pairedEnd = entry.end;
      if (index < current.entries.length - 1 && !entry.reverse) {
        makeError(errors, source, "ending-repeat-required", entry.end.start, entry.end.end);
      }
      if (index === current.entries.length - 1 && entry.reverse) {
        makeError(errors, source, "ending-final-repeat", entry.reverse.start, entry.reverse.end);
      }
      if (entry.reverse?.repeatCountExplicit || entry.reverse?.continueBarNumbers) {
        makeError(errors, source, "ending-repeat-basic", entry.reverse.start, entry.reverse.end);
      }
      if (index < current.entries.length - 1 && entry.end.numbers === null) {
        makeError(errors, source, "ending-early-final", entry.end.start, entry.end.end);
      }
      if (index === current.entries.length - 1 && entry.passes.length !== 1) {
        makeError(errors, source, "ending-final-number", entry.start.start, entry.start.end);
      }
      entry.nextStart = current.entries[index + 1]?.start?.unitIndex ?? entry.end.unitIndex + 1;
    }
  }
  assignDisplayBarNumbers(measures, repeatEnds, source, errors);
  if (errors.length) return [];

  let cursor = 0;
  let duration = rational(0);
  let division = null;
  let signature = null;
  let bpm = null;
  let explicitBpm = null;
  let bpmModulated = false;
  const playbackRoute = [];
  const ordinaryRepeats = new Map();
  const groupPasses = new Map();
  const barlineVisits = new Map();
  const repeatPasses = groups.reduce((sum, current) => sum + (current.entries.at(-1)?.passes.at(-1) ?? 0), 0)
    + repeatEnds.filter((marker) => !marker.entry).reduce((sum, marker) => sum + repeatJumpCount(marker), 0);
  const maxSteps = Math.max(1000, units.length * (repeatPasses + 3) * 3);
  let activeMeasure = null;
  let performedBarNumber = null;
  let nextPerformedBarNumber = null;
  for (let steps = 0; cursor < units.length && steps < maxSteps; steps += 1) {
    const unit = units[cursor];
    if (unit.kind === "slot") {
      if (activeMeasure !== unit.measure) {
        performedBarNumber = nextPerformedBarNumber ?? unit.measure.displayBarNumber ?? unit.measure.barNumber;
        nextPerformedBarNumber = null;
        activeMeasure = unit.measure;
      }
      const parts = [];
      const measurePosition = duration;
      for (const part of unit.slot.durationParts) {
        for (const setting of part.settings) {
          if (setting.type === "D") division = parseFraction(setting.value);
          if (setting.type === "TS") signature = setting.value === "adlib" ? "adlib" : parseFraction(setting.value);
          if (setting.type === "BPM" || setting.type === "BPMHIDDEN") {
            bpm = setting.value;
            explicitBpm = setting.value;
            bpmModulated = false;
          }
          if (setting.type === "MM") {
            const applied = applyMetricModulationValue(bpm, setting.value);
            bpm = applied?.bpm ?? null;
            bpmModulated = Boolean(applied);
          }
        }
        const partDuration = division ?? part.duration;
        parts.push({ duration: partDuration, bpm, explicitBpm, bpmModulated });
        try {
          duration = addRational(duration, partDuration);
        } catch (error) {
          if (!(error instanceof RationalRangeError)) throw error;
          makeError(errors, source, "invalid-duration-range", unit.slot.start, unit.slot.end);
          return [];
        }
      }
      playbackRoute.push({
        slot: unit.slot,
        measure: unit.measure,
        measureIndex: unit.measureIndex,
        slotIndex: unit.slotIndex,
        measurePosition,
        displayBarNumber: performedBarNumber,
        parts,
      });
    } else if (unit.kind === "barline") {
      const visit = barlineVisits.get(cursor) ?? 0;
      barlineVisits.set(cursor, visit + 1);
      if (signature && signature !== "adlib") {
        if (unit.measure.barNumber === 0 && visit === 0) {
          const actual = BigInt(duration.numerator) * BigInt(signature.denominator);
          const expected = BigInt(signature.numerator) * BigInt(duration.denominator);
          if (actual >= expected) {
            makeError(errors, source, "pickup-duration-not-shorter", unit.measure.start, unit.measure.end, {
              details: { actual: rationalLabel(duration), expected: rationalLabel(signature) },
            });
          }
        } else if (!equalRational(duration, signature)) {
          makeError(errors, source, "repeat-meter-mismatch", unit.measure.start, unit.measure.end);
        }
      }
      duration = rational(0);
      if (activeMeasure === unit.measure && performedBarNumber !== null) {
        nextPerformedBarNumber = performedBarNumber + 1;
      }
      activeMeasure = null;
    } else if (unit.kind === "ellipsis") {
      playbackRoute.push({ kind: "ellipsis", marker: unit.marker, bpm, explicitBpm, bpmModulated, timeSignature: signature });
      duration = rational(0);
      activeMeasure = null;
      performedBarNumber = null;
      nextPerformedBarNumber = null;
    } else if (unit.kind === "marker") {
      const marker = unit.marker;
      if (marker.kind === "ending-start") {
        const pass = groupPasses.get(marker.group) ?? 1;
        if (!marker.entry.passes.includes(pass)) {
          cursor = marker.entry.nextStart;
          continue;
        }
      }
      if (marker.kind === "repeat-end") {
        const completedRepeats = ordinaryRepeats.get(marker) ?? 0;
        const shouldJump = marker.entry ? true : completedRepeats < repeatJumpCount(marker);
        if (shouldJump) {
          if (marker.entry) groupPasses.set(marker.group, (groupPasses.get(marker.group) ?? 1) + 1);
          else ordinaryRepeats.set(marker, completedRepeats + 1);
          if (signature && signature !== "adlib") {
            const left = duration.numerator * signature.denominator;
            const right = signature.numerator * duration.denominator;
            if (left > right) makeError(errors, source, "repeat-meter-mismatch", marker.start, marker.end);
            if (left === right) duration = rational(0);
          }
          const destination = units.slice(marker.jumpIndex).find((candidate) => candidate.kind === "slot");
          const immediateSignature = destination?.slot.durationParts[0]?.settings.find((setting) =>
            setting.type === "TS" && setting.start >= (marker.explicitStart?.end ?? 0));
          if (!immediateSignature && !sameSignature(signature, marker.jumpState.timeSignature)) {
            makeError(errors, source, "repeat-time-signature-mismatch", marker.start, marker.end);
          }
          division = marker.jumpState.division;
          signature = marker.jumpState.timeSignature;
          bpm = marker.jumpState.bpm;
          explicitBpm = marker.jumpState.explicitBpm;
          bpmModulated = marker.jumpState.bpmModulated;
          nextPerformedBarNumber = marker.continueBarNumbers
            ? (activeMeasure && performedBarNumber !== null ? performedBarNumber + 1 : nextPerformedBarNumber)
            : destination?.measure?.displayBarNumber ?? destination?.measure?.barNumber ?? null;
          activeMeasure = null;
          cursor = marker.jumpIndex;
          continue;
        }
      }
    }
    cursor += 1;
  }
  if (cursor < units.length) makeError(errors, source, "repeat-cycle", 0, 1);
  return errors.length ? [] : playbackRoute;
}
