import { addRational, rational, rationalLabel } from "./mstruct-rational.js";

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function lcm(left, right) {
  return Math.abs((left / gcd(left, right)) * right) || 1;
}

function measureDenominator(measure) {
  const signature = /^(\d+)\/(\d+)$/.exec(String(measure?.timeSignatureLabel ?? ""));
  let denominator = signature ? Number(signature[2]) : 1;
  for (const slot of measure?.slots ?? []) denominator = lcm(denominator, slot.duration?.denominator ?? 1);
  return denominator;
}

function routeSlots(result) {
  return (result?.playbackRoute ?? []).filter((entry) => entry?.slot && entry?.measure);
}

function structuralSlots(result) {
  return (result?.flow ?? [])
    .filter((item) => item.kind === "measure" && item.measure?.complete)
    .flatMap((item) => item.measure.slots.map((slot) => ({ slot, measure: item.measure })));
}

function slotPosition(entry, atEnd) {
  const parts = entry.parts ?? [];
  const position = parts.reduce(
    (sum, part) => addRational(sum, part.duration),
    entry.measurePosition ?? rational(0),
  );
  if (!atEnd) {
    const denominator = measureDenominator(entry.measure);
    const start = entry.measurePosition ?? rational(0);
    return rationalLabel(addRational(start, rational(1, denominator)));
  }
  const signature = /^(\d+)\/(\d+)$/.exec(entry.measure?.timeSignatureLabel ?? "");
  if (signature) {
    const denominator = Number(signature[2]);
    const numerator = position.numerator * denominator / position.denominator;
    if (Number.isInteger(numerator)) return `${numerator}/${denominator}`;
  }
  return rationalLabel(position);
}

/**
 * Converts the finite route produced by the existing simple-repeat parser into
 * explicit .mstructtime LOOP instructions. It intentionally handles only the
 * already-supported repeat/ending route; arbitrary timeline jumps belong to
 * the future .mstructtime parser.
 */
export function createMstructtimeLoopInstructions(result) {
  if (!result?.ok) return [];
  if (result.hasContinuousBarNumberRepeats) return null;
  const route = routeSlots(result);
  const score = structuralSlots(result);
  const nextScoreSlot = new Map(score.map((entry, index) => [entry.slot, score[index + 1]?.slot ?? null]));
  const visitsBySlot = new Map();

  for (const [index, entry] of route.entries()) {
    const next = route[index + 1] ?? null;
    const visits = visitsBySlot.get(entry.slot) ?? [];
    visits.push({ entry, next });
    visitsBySlot.set(entry.slot, visits);
  }

  const controlSlots = new Set();
  for (const [slot, visits] of visitsBySlot) {
    const hasRepeatEnd = slot.markersAfter?.some((marker) => marker.kind === "repeat-end");
    const changesRoute = visits.some(({ next }) => next && next.slot !== nextScoreSlot.get(slot));
    if (hasRepeatEnd || changesRoute) controlSlots.add(slot);
  }

  const passBySlot = new Map();
  const instructions = [];
  for (const [index, entry] of route.entries()) {
    if (!controlSlots.has(entry.slot)) continue;
    const next = route[index + 1];
    if (!next) continue;
    const pass = (passBySlot.get(entry.slot) ?? 0) + 1;
    passBySlot.set(entry.slot, pass);
    instructions.push([
      entry.measure.barNumber,
      slotPosition(entry, true),
      pass,
      next.measure.barNumber,
      slotPosition(next, false),
    ].join(",") + ";");
  }
  return instructions;
}

export function createMstructtimeLoopSource(result) {
  const instructions = createMstructtimeLoopInstructions(result);
  return instructions === null ? null : instructions.join("\n");
}
