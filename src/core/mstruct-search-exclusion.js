import { MSTRUCT_SEARCH_QUERY_LIMITS, wholeOrGroup } from "./mstruct-search-choice.js";

function diagnostic(code, start, end, details = {}) {
  return { code, start, end: Math.max(start + 1, end), details };
}

function trimSpan(value, start) {
  const leading = value.length - value.trimStart().length;
  const trimmed = value.trim();
  return { value: trimmed, start: start + leading, end: start + leading + trimmed.length };
}

/** Extract a terminal field NOT without interpreting any musical parentheses. */
export function extractFieldExclusion(source, domain, start, errors, context) {
  const bang = source.indexOf("!");
  if (bang < 0) return undefined;
  const fail = (at = bang, end = source.length) => {
    errors.push(diagnostic("search-not-invalid", start + at, start + end, { domain }));
    return null;
  };
  if (source.length > MSTRUCT_SEARCH_QUERY_LIMITS.fieldLength) {
    errors.push(diagnostic("search-field-pattern-invalid", start, start + source.length, { domain }));
    return null;
  }
  if ([...source].filter((character) => ["*", "?"].includes(character)).length > MSTRUCT_SEARCH_QUERY_LIMITS.wildcardsPerField) {
    errors.push(diagnostic("search-field-pattern-too-complex", start, start + source.length, { domain }));
    return null;
  }
  const closing = { "(": ")", "[": "]", "{": "}", "<": ">" };
  const stack = [];
  for (let index = 0; index < bang; index += 1) {
    const character = source[index];
    if (closing[character]) stack.push(closing[character]);
    else if ([")", "]", "}", ">"].includes(character)) {
      if (stack.pop() !== character) return fail(index, index + 1);
    }
  }
  const positive = trimSpan(source.slice(0, bang), start);
  if (stack.length || !positive.value) return fail();
  let open = bang + 1;
  while (/\s/.test(source[open] ?? "")) open += 1;
  if (source[open] !== "(") return fail();
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "!") return fail(index, index + 1);
    if (closing[character]) stack.push(closing[character]);
    else if ([")", "]", "}", ">"].includes(character)) {
      if (stack.pop() !== character) return fail(index, index + 1);
      if (!stack.length) { end = index; break; }
    }
  }
  if (end < 0 || source.slice(end + 1).trim()) return fail();
  const body = source.slice(open + 1, end);
  const before = errors.length;
  let branches;
  if (body.includes("||")) {
    branches = wholeOrGroup(source.slice(open, end + 1), start + open, errors, context.or);
    if (!branches || branches.some((branch) => branch.value.includes("||"))) return fail(open, end + 1);
  } else branches = [trimSpan(body, start + open + 1)];
  if (branches.some((branch) => !branch.value)) return fail(open, end + 1);
  if (errors.length !== before) return null;
  context.notGroups += 1;
  return { positive, branches };
}

export function positiveFieldPattern(pattern) {
  return pattern?.kind === "exclude" ? pattern.include : pattern;
}
