import { parseFraction, rationalLabel } from "./mstruct-rational.js";

const BPM_PATTERN = /^(\d+)\s*\/\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)$/;
const METRIC_MODULATION_PATTERN = /^(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)\s*\/\s*(\d+)$/;

export function parseBpmValue(value) {
  const match = BPM_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  const beat = parseFraction(`${match[1]}/${match[2]}`);
  if (!beat || beat.numerator <= 0 || !Number.isFinite(Number(match[3])) || Number(match[3]) <= 0) return null;
  return { beat, beatLabel: rationalLabel(beat), tempo: match[3] };
}

export function parseMetricModulationValue(value) {
  const match = METRIC_MODULATION_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  const from = parseFraction(`${match[1]}/${match[2]}`);
  const to = parseFraction(`${match[3]}/${match[4]}`);
  if (!from || !to || from.numerator <= 0 || to.numerator <= 0) return null;
  return { from, to, fromLabel: rationalLabel(from), toLabel: rationalLabel(to) };
}

export function applyMetricModulationValue(bpmValue, metricModulationValue) {
  const bpm = parseBpmValue(bpmValue);
  const modulation = parseMetricModulationValue(metricModulationValue);
  if (!bpm || !modulation) return null;
  // Keep the tempo decimal exact by applying the ratio to its beat unit.
  let numerator = BigInt(bpm.beat.numerator) * BigInt(modulation.to.numerator) * BigInt(modulation.from.denominator);
  let denominator = BigInt(bpm.beat.denominator) * BigInt(modulation.to.denominator) * BigInt(modulation.from.numerator);
  let a = numerator;
  let b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  const beat = parseFraction(`${numerator}/${denominator}`);
  if (!beat) return null;
  return {
    ...modulation,
    tempo: bpm.tempo,
    bpm: `${rationalLabel(beat)}=${bpm.tempo}`,
  };
}

function roundedTempo(value) {
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return String(rounded);
}

export function referenceBpmValue(currentBpmValue, explicitBpmValue) {
  const current = parseBpmValue(currentBpmValue);
  const reference = parseBpmValue(explicitBpmValue);
  if (!current || !reference) return null;
  const tempo = Number(current.tempo)
    * (current.beat.numerator / current.beat.denominator)
    / (reference.beat.numerator / reference.beat.denominator);
  return `${reference.beatLabel}=${roundedTempo(tempo)}`;
}
