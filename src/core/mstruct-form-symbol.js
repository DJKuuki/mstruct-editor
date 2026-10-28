import { makeError } from "./mstruct-diagnostics.js";

const VALID_PART = /^[\x20-\x7E]*$/;

export function parseFormSymbolToken(token, source, errors) {
  if (!/^\s*F\s*:/i.test(token.content)) return null;
  const match = /^\s*F\s*:\s*([^|]*)\|([^|]*)\|([^|]*)\s*$/.exec(token.content);
  if (!match) {
    makeError(errors, source, "invalid-form-symbol", token.start, token.end);
    return { invalid: true };
  }
  const [body, superscript, subscript] = match.slice(1).map((value) => value.trim());
  if (!body || ![body, superscript, subscript].every((value) => VALID_PART.test(value) && !/[\[\]|]/.test(value))) {
    makeError(errors, source, "invalid-form-symbol", token.start, token.end);
    return { invalid: true };
  }
  return { body, superscript, subscript, start: token.start, end: token.end };
}
