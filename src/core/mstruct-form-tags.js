import { applyTagToken, activeTagOccurrences } from "./mstruct-tags.js";
import { makeError } from "./mstruct-diagnostics.js";

export function createFormState() { return { implicit: new Map() }; }
export function implicitForms(formState) { return [...formState.implicit.values()]; }

export function formSnapshot(state) {
  return { implicit: implicitForms(state.formState), explicit: activeTagOccurrences(state.tagState).filter((tag) => tag.form) };
}

function activate(implicit, tag) {
  if (tag.replacePrevious && !tag.allowGlobal) for (const [key, previous] of implicit) {
    if (previous.group === tag.group && !previous.allowGlobal) implicit.delete(key);
  }
}

function endImplicit(implicit, target) {
  for (const [key, tag] of implicit) if (!target || (target.family ? tag.group === target.name : key === target.token)) implicit.delete(key);
}

/** Returns false only for tokens outside this profile's form domain. */
export function applyFormTagToken(context) {
  const { token, formTagConfig: config, state, slot, source, errors } = context;
  if (!config) return false;
  const inner = token.content.replace(/^(?:\*\/|\/)/, "");
  const control = /^FORM_END(?::|$)/.test(inner);
  const definition = config.byToken.get(`<${inner}>`);
  if (!control && !definition) return false;
  slot.formCommands ??= [];
  if (control) {
    const name = inner === "FORM_END" ? "" : inner.slice("FORM_END:".length);
    const targetDefinition = name ? config.byToken.get(`<${name}>`) : null;
    if (!token.content.startsWith("/FORM_END") || inner !== "FORM_END" && (!name || !targetDefinition)) {
      makeError(errors, source, "invalid-tag-parameter", token.start, token.end, { domain: "tag", details: { token: source.slice(token.start, token.end) } });
      return true;
    }
    if (slot.closedByControl) makeError(errors, source, "control-marker-order", token.start, token.end);
    const key = `FORM_END:${name}`;
    if (slot.tagTokensSeen.has(key)) {
      makeError(errors, source, "duplicate-tag", token.start, token.end, { domain: "tag", details: { token: source.slice(token.start, token.end) } });
      return true;
    }
    slot.tagTokensSeen.add(key);
    const target = name ? { name, token: targetDefinition.token, family: !targetDefinition.parent } : null;
    endImplicit(state.formState.implicit, target);
    let lane = 0;
    while (slot.tagOccupiedLanes.has(lane)) lane += 1;
    slot.tagOccupiedLanes.add(lane);
    slot.tags.push({ kind: "oneshot", form: true, formControl: true, token: `</${inner}>`, key,
      zhName: targetDefinition ? `${targetDefinition.zhName}结束` : "曲式结束",
      enName: targetDefinition ? `${targetDefinition.enName} End` : "Form End", lane, start: token.start, end: token.end });
    slot.formCommands.push({ type: "end", target });
  } else {
    const before = errors.length;
    const tagIndex = slot.tags.length;
    applyTagToken({ ...context, tagConfig: config });
    if (errors.length !== before) return true;
    const tag = slot.tags[tagIndex];
    if (!tag) return true;
    if (tag.kind === "start" || tag.kind === "oneshot") {
      activate(state.formState.implicit, tag);
      state.formState.implicit.delete(tag.token);
      if (tag.kind === "oneshot") {
        tag.formImplicit = true;
        state.formState.implicit.set(tag.token, tag);
      }
      slot.formCommands.push({ type: "activate", tag, paired: tag.kind === "start", optionalClose: definition.durationMode === 2 && token.content.startsWith("/") });
    } else slot.formCommands.push({ type: "close", tag, optionalClose: definition.durationMode === 2 && token.content.startsWith("/") });
  }
  slot.activeForms = implicitForms(state.formState);
  return true;
}

/** Replay per visit. Backward jumps restore the target's pre-command snapshot;
 * forward ending skips inherit only the route actually performed. */
export function createFormRouteProjector() {
  let implicit = new Map(), explicit = new Map(), previousStart = null;
  return (source) => {
    if (previousStart === null || source.start <= previousStart) {
      implicit = new Map((source.formBefore?.implicit ?? []).map((tag) => [tag.token, tag]));
      explicit = new Map((source.formBefore?.explicit ?? []).map((tag) => [tag.token, tag]));
    }
    previousStart = source.start;
    const ending = [];
    for (const command of source.formCommands ?? []) {
      if (command.optionalClose) {
        if (explicit.has(command.tag.token)) {
          explicit.delete(command.tag.token);
          ending.push(command.tag);
        } else {
          activate(implicit, command.tag);
          implicit.set(command.tag.token, command.tag);
        }
      } else if (command.type === "end") endImplicit(implicit, command.target);
      else if (command.type === "close") {
        explicit.delete(command.tag.token);
        ending.push(command.tag);
      } else {
        activate(implicit, command.tag);
        implicit.delete(command.tag.token);
        (command.paired ? explicit : implicit).set(command.tag.token, command.tag);
      }
    }
    return [...new Map([...implicit.values(), ...explicit.values(), ...ending].map((tag) => [tag.token, tag])).values()];
  };
}
