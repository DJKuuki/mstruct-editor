import { makeError } from "./mstruct-diagnostics.js";
import { matchTonalReference, parseTonalReference, tonalReferencePitchClass } from "./tonal-reference.js";

/** Source order is presentation only. Query pairs are matched in either order. */
export function parseDtcPair(value, { query = false } = {}) {
  const values = String(value).split(",");
  if (values.length !== 2) return null;
  const references = values.map((note) => parseTonalReference(query && note === "?" ? "*" : note, { query }));
  if (references.some((reference) => !reference || reference.ambiguous)) return null;
  if (references.every((reference) => reference.kind === "note")
    && references[0].mode === references[1].mode
    && tonalReferencePitchClass(values[0]) === tonalReferencePitchClass(values[1])) return null;
  return references.map((reference) => reference.value);
}

export function matchDtcPair(pattern, token) {
  const match = /^<DTC:([^>]+)>$/.exec(token);
  const pair = match && parseDtcPair(match[1]);
  if (!pair) return false;
  return [pair, [pair[1], pair[0]]].some((values) =>
    pattern.every((note, index) => matchTonalReference(note, values[index])));
}

export function dtcDefinition(pair) {
  const parts = (prefix) => [
    { type: "literal", value: prefix },
    { type: "note", value: pair[0] },
    { type: "literal", value: ", " },
    { type: "note", value: pair[1] },
  ];
  const zhParts = parts("双主音复合体：");
  const enParts = parts("Double-Tonic Complex: ");
  return {
    token: `<DTC:${pair.join(",")}>`, key: "semantic:dtc", semanticKind: "dtc",
    zhParts, enParts,
    zhName: zhParts.map((part) => part.value).join(""),
    enName: enParts.map((part) => part.value).join(""),
  };
}

export function createDtcState(global = null) { return { current: global, global }; }

/** DTC is an implicit singleton, independent of TC, paired tags and form groups. */
export function applyDtcTagToken({ token, state, slot, source, errors }) {
  const body = token.content.replace(/^(?:\*\/|\/)/, "");
  if (!/^DTC(?::|$)/.test(body)) return false;
  if (state.dtcState.global) {
    makeError(errors, source, "global-dtc-main-conflict", token.start, token.end, { domain: "tag" });
    return true;
  }
  const closing = token.content === "/DTC";
  const pair = token.content.startsWith("DTC:") ? parseDtcPair(token.content.slice(4)) : null;
  if (!closing && !pair) {
    makeError(errors, source, "invalid-tag-parameter", token.start, token.end, {
      domain: "tag", details: { token: source.slice(token.start, token.end) },
    });
    return true;
  }
  if (slot.closedByControl) makeError(errors, source, "control-marker-order", token.start, token.end);
  let lane = 0;
  while (slot.tagOccupiedLanes.has(lane)) lane += 1;
  slot.tagOccupiedLanes.add(lane);
  const tag = {
    ...(pair ? dtcDefinition(pair) : {
      token: "</DTC>", key: "semantic:dtc", semanticKind: "dtc", dtcControl: true,
      zhName: "双主音复合体结束", enName: "Double-Tonic Complex End",
      zhParts: [{ type: "literal", value: "双主音复合体结束" }],
      enParts: [{ type: "literal", value: "Double-Tonic Complex End" }],
    }),
    kind: "oneshot", lane, start: token.start, end: token.end,
  };
  state.dtcState.current = closing ? null : tag;
  slot.activeDtc = state.dtcState.current;
  slot.dtcCommands.push(state.dtcState.current);
  slot.tags.push(tag);
  return true;
}

/** Backward jumps restore the source snapshot; skipped endings do not leak state. */
export function createDtcRouteProjector() {
  let current = null, previousStart = null;
  return (source) => {
    if (previousStart === null || source.start <= previousStart) current = source.dtcBefore ?? null;
    previousStart = source.start;
    for (const next of source.dtcCommands ?? []) current = next;
    return current;
  };
}
