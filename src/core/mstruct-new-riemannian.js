import { makeError } from "./mstruct-diagnostics.js";

const PLR_SEQUENCE = /^[PLR]{1,6}$/;
const SINGLE_TRANSFORMATION = /^[NSH]$/;

export function parseNewRiemannianToken(token, source, errors) {
  const entry = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(token.content);
  if (!entry || entry[1].toUpperCase() !== "NR") return null;

  const value = entry[2];
  if (entry[1] !== "NR" || (!PLR_SEQUENCE.test(value) && !SINGLE_TRANSFORMATION.test(value))) {
    makeError(errors, source, "invalid-new-riemannian", token.start, token.end);
    return { invalid: true, start: token.start, end: token.end };
  }
  return { value, start: token.start, end: token.end };
}

export function applyNewRiemannianToken({ transformation, slot, source, errors }) {
  if (transformation.invalid) return;
  if (slot.newRiemannian) {
    makeError(errors, source, "duplicate-new-riemannian", transformation.start, transformation.end);
    return;
  }
  slot.newRiemannian = { ...transformation, consumed: false };
}

export function attachNewRiemannianTarget({ event, previousEvent, slot, source, errors }) {
  const transformation = slot.newRiemannian;
  if (!transformation || transformation.consumed) return;
  transformation.consumed = true;

  if (!event.chordResult) {
    makeError(errors, source, "new-riemannian-target-chord", transformation.start, transformation.end);
    return;
  }
  const sourceIsChord = Boolean(previousEvent?.chordResult);
  const sourceIsContinuation = previousEvent?.symbolType === "continuation";
  if (!sourceIsChord && !sourceIsContinuation) {
    makeError(errors, source, "new-riemannian-source", transformation.start, transformation.end);
    return;
  }

  event.newRiemannian = {
    value: transformation.value,
    start: transformation.start,
    end: transformation.end,
    sourceEventOrder: previousEvent.order,
    sourceType: sourceIsContinuation ? "continuation" : "chord",
  };
}

export function finishNewRiemannianSlot(slot, source, errors) {
  if (slot.newRiemannian && !slot.newRiemannian.consumed) {
    makeError(
      errors,
      source,
      "new-riemannian-target-required",
      slot.newRiemannian.start,
      slot.newRiemannian.end,
    );
  }
}
