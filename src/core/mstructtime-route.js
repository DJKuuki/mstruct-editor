import { addRational, equalRational, rational, rationalLabel } from "./mstruct-rational.js";
import { mstructtimeTimestampKey, parseMstructtimeLoop, parseMstructtimeMain } from "./mstructtime-document.js";

function subtractRational(left, right) {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function compareRational(left, right) {
  return left.numerator * right.denominator - right.numerator * left.denominator;
}

function lcm(left, right) {
  const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a || 1);
  return Math.abs((left / gcd(left, right)) * right) || 1;
}

function measureDenominator(measure) {
  const signature = /^(\d+)\/(\d+)$/.exec(String(measure?.timeSignatureLabel ?? ""));
  let denominator = signature ? Number(signature[2]) : 1;
  for (const slot of measure?.slots ?? []) {
    denominator = lcm(denominator, slot.duration?.denominator ?? 1);
  }
  return denominator;
}

function beatLabel(position, denominator) {
  const common = lcm(denominator, position.denominator);
  const numerator = position.numerator * (common / position.denominator) + 1;
  return `${numerator}/${common}`;
}

function locationStart(location) {
  return rational(location.numerator - 1, location.denominator);
}

function locationEnd(location) {
  return rational(location.numerator, location.denominator);
}

function nodeStartKey(measure, position) {
  return `${measure}:${rationalLabel(position)}`;
}

function nodeEndKey(measure, position) {
  return `${measure}:${rationalLabel(position)}`;
}

export function buildMstructtimeStructuralNodes(result) {
  const nodes = [];
  let previousMeasure = null;
  for (const item of result?.flow ?? []) {
    if (item.kind === "measure" && item.measure?.complete) {
      const measure = item.measure;
      let position = rational(0);
      const denominator = measureDenominator(measure);
      for (const slot of measure.slots ?? []) {
        const start = position;
        const end = addRational(start, slot.duration ?? rational(0));
        nodes.push({
          kind: "slot",
          id: `slot-${slot.start}`,
          slotId: String(slot.start),
          measure: measure.barNumber,
          measureObject: measure,
          position: start,
          endPosition: end,
          beat: beatLabel(start, denominator),
          sourceBeat: rationalLabel(end),
          timeSignatureLabel: measure.timeSignatureLabel ?? null,
          slot,
        });
        position = end;
      }
      previousMeasure = measure;
      continue;
    }
    if (item.kind !== "ellipsis") continue;
    const insideMeasure = previousMeasure?.truncatedByEllipsis === true;
    const measure = insideMeasure ? previousMeasure.barNumber : (previousMeasure?.barNumber ?? 0) + 1;
    const position = insideMeasure ? previousMeasure.duration : rational(0);
    const denominator = measureDenominator(previousMeasure);
    nodes.push({
      kind: "ellipsis",
      id: `ellipsis-${item.start}`,
      slotId: `ellipsis-${item.start}`,
      measure,
      measureObject: previousMeasure,
      position,
      endPosition: position,
      beat: beatLabel(position, denominator),
      sourceBeat: beatLabel(position, denominator),
      timeSignatureLabel: item.timeSignatureLabel ?? previousMeasure?.timeSignatureLabel ?? null,
      marker: item,
    });
  }
  return nodes;
}

export function buildMstructtimeRoute(result, loopSource = "") {
  const parsedLoop = parseMstructtimeLoop(loopSource);
  if (!result?.ok) return { ok: false, nodes: [], route: [], errors: [{ code: "mstructtime-analysis-invalid", line: 1 }] };
  if (!parsedLoop.ok) return { ok: false, nodes: [], route: [], errors: parsedLoop.errors };
  const nodes = buildMstructtimeStructuralNodes(result);
  const startIndex = new Map();
  const endIndex = new Map();
  nodes.forEach((node, index) => {
    startIndex.set(nodeStartKey(node.measure, node.position), index);
    if (node.kind === "slot") endIndex.set(nodeEndKey(node.measure, node.endPosition), index);
    else endIndex.set(nodeEndKey(node.measure, node.position), index);
  });
  const instructions = new Map();
  const errors = [];
  for (const instruction of parsedLoop.instructions) {
    const sourceKey = nodeEndKey(instruction.sourceMeasure, locationEnd(instruction.sourceLocation));
    const sourceNodeIndex = endIndex.get(sourceKey);
    if (sourceNodeIndex === undefined) errors.push({ code: "mstructtime-loop-source-missing", line: instruction.line });
    if (sourceNodeIndex === undefined) continue;
    if (instruction.type === "end") {
      instructions.set(`${sourceNodeIndex}:${instruction.pass}`, { type: "end" });
      continue;
    }
    const targetKey = nodeStartKey(instruction.targetMeasure, locationStart(instruction.targetLocation));
    const targetNodeIndex = startIndex.get(targetKey);
    if (targetNodeIndex === undefined) {
      errors.push({ code: "mstructtime-loop-target-missing", line: instruction.line });
      continue;
    }
    instructions.set(`${sourceNodeIndex}:${instruction.pass}`, { type: "jump", targetNodeIndex });
  }
  if (errors.length) return { ok: false, nodes, route: [], errors };

  const route = [];
  const visits = new Map();
  let cursor = 0;
  const maximumSteps = Math.max(1000, nodes.length * Math.max(4, parsedLoop.instructions.length + 2) * 10);
  for (let step = 0; cursor < nodes.length && step < maximumSteps; step += 1) {
    const node = nodes[cursor];
    const pass = (visits.get(node.id) ?? 0) + 1;
    visits.set(node.id, pass);
    route.push({ ...node, pass, routeIndex: route.length });
    const instruction = instructions.get(`${cursor}:${pass}`);
    if (instruction?.type === "end") {
      cursor = nodes.length;
      break;
    }
    cursor = instruction?.targetNodeIndex ?? cursor + 1;
  }
  if (cursor < nodes.length) errors.push({ code: "mstructtime-loop-cycle", line: 1 });
  return { ok: errors.length === 0, nodes, route: errors.length ? [] : route, errors };
}

export function buildMstructtimeEventRows(result, loopSource = "", mainSource = "") {
  const route = buildMstructtimeRoute(result, loopSource);
  const parsedMain = parseMstructtimeMain(mainSource);
  const errors = [...route.errors, ...parsedMain.errors];
  if (!route.ok || !parsedMain.ok) return { ok: false, rows: [], entries: parsedMain.entries, errors };
  const timestamps = new Map(parsedMain.entries.map((entry) => [mstructtimeTimestampKey(entry), entry.milliseconds]));
  const rows = [{ kind: "start", number: 0, measure: null, beat: null, pass: 1, milliseconds: 0, routeIndex: -1 }];
  for (const visit of route.route) {
    if (visit.kind === "slot" && !(visit.slot?.events?.length)) continue;
    const kind = visit.kind === "ellipsis" ? "ellipsis" : "event";
    const key = mstructtimeTimestampKey({ kind, measure: visit.measure, position: visit.position, pass: visit.pass });
    rows.push({
      kind,
      number: rows.length,
      measure: visit.measure,
      beat: visit.beat,
      position: visit.position,
      pass: visit.pass,
      timeSignatureLabel: visit.timeSignatureLabel,
      milliseconds: timestamps.has(key) ? timestamps.get(key) : null,
      key,
      slotId: visit.slotId,
      routeIndex: visit.routeIndex,
      source: visit.slot ?? visit.marker,
    });
  }
  let previous = 0;
  for (const row of rows.slice(1)) {
    if (row.milliseconds === null) continue;
    if (row.milliseconds < previous) errors.push({ code: "mstructtime-timestamp-order", line: 1, details: { number: row.number } });
    previous = row.milliseconds;
  }
  return { ok: errors.length === 0, rows, entries: parsedMain.entries, errors };
}

function bracketEntries(entries) {
  return entries
    .slice()
    .sort((left, right) => left.pass - right.pass)
    .map((entry) => `[${entry.milliseconds ?? ""},${entry.pass}]`)
    .join("");
}

function groupEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const location = `${entry.kind}:${entry.measure}:${rationalLabel(entry.position)}`;
    if (!grouped.has(location)) grouped.set(location, []);
    grouped.get(location).push(entry);
  }
  return grouped;
}

function settingsForSlot(slot, firstInMeasure, measure) {
  const values = [];
  if (firstInMeasure) {
    values.push(`{BN:${measure.barNumber}}`);
    if (measure.timeSignatureLabel) values.push(`{TS:${measure.timeSignatureLabel}}`);
  }
  const durationLabel = slot.durationLabel ?? rationalLabel(slot.duration ?? rational(1));
  values.push(`{D:${durationLabel}}`);
  return values.join("");
}

export function serializeMstructtimeMain(result, rows, preservedEntries = []) {
  const activeEntries = rows.filter((row) => row.kind !== "start").map((row) => ({
    kind: row.kind,
    measure: row.measure,
    position: row.position ?? resultPositionForRow(result, row),
    pass: row.pass,
    milliseconds: row.milliseconds,
  })).filter((entry) => entry.position);
  const combined = new Map();
  for (const entry of [...preservedEntries, ...activeEntries]) combined.set(mstructtimeTimestampKey(entry), entry);
  const grouped = groupEntries([...combined.values()]);
  const consumed = new Set();
  const lines = [];
  let previousMeasure = null;

  for (const item of result?.flow ?? []) {
    if (item.kind === "measure" && item.measure?.complete) {
      const measure = item.measure;
      let position = rational(0);
      let line = "";
      for (const [index, slot] of (measure.slots ?? []).entries()) {
        const location = `event:${measure.barNumber}:${rationalLabel(position)}`;
        const values = grouped.get(location) ?? [];
        if (values.length) consumed.add(location);
        line += settingsForSlot(slot, index === 0, measure);
        line += bracketEntries(values);
        position = addRational(position, slot.duration ?? rational(0));
        line += index === measure.slots.length - 1 ? (measure.truncatedByEllipsis ? "" : ";") : ",";
      }
      lines.push(line);
      previousMeasure = measure;
      continue;
    }
    if (item.kind !== "ellipsis") continue;
    const insideMeasure = previousMeasure?.truncatedByEllipsis === true;
    const measure = insideMeasure ? previousMeasure.barNumber : (previousMeasure?.barNumber ?? 0) + 1;
    const position = insideMeasure ? previousMeasure.duration : rational(0);
    const location = `ellipsis:${measure}:${rationalLabel(position)}`;
    const values = grouped.get(location) ?? [];
    if (values.length) consumed.add(location);
    lines.push(`...${bracketEntries(values)}`);
  }

  // Keep unmatched timestamps recoverable after LOOP or analysis changes. They
  // are serialized as explicit orphan coordinates and ignored by the active route.
  for (const [location, entries] of grouped) {
    if (consumed.has(location)) continue;
    const [kind, measureText, rationalText] = location.split(":");
    const [numeratorText, denominatorText] = rationalText.split("/");
    const measure = Number(measureText);
    const position = rational(Number(numeratorText), Number(denominatorText));
    const prefix = `{BN:${measure}}${compareRational(position, rational(0)) > 0 ? `{D:${rationalLabel(position)}},` : "{D:1}"}`;
    lines.push(kind === "ellipsis" ? `${prefix}...${bracketEntries(entries)}` : `${prefix}${bracketEntries(entries)};`);
  }
  return lines.filter(Boolean).join("\n");
}

function resultPositionForRow(result, row) {
  const route = buildMstructtimeStructuralNodes(result);
  const node = route.find((candidate) => candidate.slotId === row.slotId && candidate.measure === row.measure && candidate.beat === row.beat);
  return node?.position ?? null;
}

export function updateMstructtimeRows(rows, number, milliseconds) {
  return rows.map((row) => row.number === number ? { ...row, milliseconds } : row);
}

export function resetMstructtimeRows(rows, measure) {
  return rows.map((row) => row.kind !== "start" && row.measure >= measure ? { ...row, milliseconds: null } : row);
}

export { compareRational, subtractRational };
