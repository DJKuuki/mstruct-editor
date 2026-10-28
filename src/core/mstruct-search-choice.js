export const MSTRUCT_SEARCH_QUERY_LIMITS = Object.freeze({
  sourceLength: 4096,
  events: 32,
  fieldLength: 256,
  wildcardsPerField: 16,
  globalTags: 16,
  orBranchesPerGroup: 8,
  orGroups: 8,
  orBranchesTotal: 32,
  notGroups: 32,
  workScore: 512,
});

function diagnostic(code, start, end, details = {}) {
  return { code, start, end: Math.max(start + 1, end), details };
}

function trimSpan(part) {
  const leading = part.value.length - part.value.trimStart().length;
  const value = part.value.trim();
  const start = part.start + leading;
  return { value, start, end: start + value.length };
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function semanticChoiceValue(value) {
  if (Array.isArray(value)) return value.map(semanticChoiceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["start", "end"].includes(key))
      .map(([key, entry]) => [key, semanticChoiceValue(entry)]));
  }
  return value;
}

function registerOrGroup(branches, tracker, errors, start, end) {
  tracker.groups += 1;
  tracker.branches += branches.length;
  if (branches.length > MSTRUCT_SEARCH_QUERY_LIMITS.orBranchesPerGroup) {
    errors.push(diagnostic("search-or-limit", start, end, { limit: MSTRUCT_SEARCH_QUERY_LIMITS.orBranchesPerGroup }));
  }
}

function splitOrBranches(source, offset, errors, tracker) {
  const parts = [];
  const stack = [];
  const closing = { "[": "]", "(": ")", "{": "}", "<": ">" };
  let start = 0;
  let found = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (closing[character]) stack.push(closing[character]);
    else if (stack.at(-1) === character) stack.pop();
    if (!source.startsWith("||", index)) continue;
    if (stack.length) {
      errors.push(diagnostic("search-or-nested", offset + index, offset + index + 2));
      index += 1;
      continue;
    }
    found = true;
    parts.push({ value: source.slice(start, index), start: offset + start, end: offset + index });
    start = index + 2;
    index += 1;
  }
  if (!found) return null;
  parts.push({ value: source.slice(start), start: offset + start, end: offset + source.length });
  const branches = parts.map(trimSpan);
  for (const branch of branches) {
    if (!branch.value) errors.push(diagnostic("search-or-empty-branch", branch.start, Math.max(branch.start + 1, branch.end)));
  }
  registerOrGroup(branches, tracker, errors, offset - 1, offset + source.length + 1);
  return branches;
}

export function wholeOrGroup(source, start, errors, tracker) {
  if (!source.startsWith("(") || !source.endsWith(")")) return null;
  const stack = [];
  let closingIndex = -1;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "(") stack.push(index);
    else if (source[index] === ")") {
      stack.pop();
      if (!stack.length) {
        closingIndex = index;
        break;
      }
    }
  }
  if (closingIndex !== source.length - 1) return null;
  return splitOrBranches(source.slice(1, -1), start + 1, errors, tracker);
}

export function embeddedOrGroups(source, start, errors, tracker) {
  const stack = [];
  const frames = [];
  const closing = { "[": "]", "(": ")", "{": "}", "<": ">" };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (closing[character]) {
      const frame = { open: character, close: closing[character], start: index, end: -1, parent: stack.at(-1) ?? null, isOr: false };
      stack.push(frame);
      frames.push(frame);
      continue;
    }
    if (stack.at(-1)?.close === character) {
      stack.at(-1).end = index;
      stack.pop();
      continue;
    }
    if (source.startsWith("||", index)) {
      const frame = stack.at(-1);
      if (!frame || frame.open !== "(") errors.push(diagnostic("search-or-invalid", start + index, start + index + 2));
      else frame.isOr = true;
      index += 1;
    }
  }
  const groups = frames.filter((frame) => frame.isOr);
  for (const group of groups) {
    if (group.end < 0) {
      errors.push(diagnostic("search-token-unclosed", start + group.start, start + source.length, { opener: "(" }));
      continue;
    }
    if (group.parent) errors.push(diagnostic("search-or-nested", start + group.start, start + group.end + 1));
    group.branches = splitOrBranches(source.slice(group.start + 1, group.end), start + group.start + 1, errors, tracker) ?? [];
  }
  return groups.filter((group) => group.end >= 0 && !group.parent).sort((left, right) => left.start - right.start);
}

export function normalizeChoiceBranches(branches, { wildcardCovers = false } = {}) {
  const unique = new Map();
  for (const branch of branches) unique.set(stableStringify(semanticChoiceValue(branch)), branch);
  const values = [...unique.values()];
  if (wildcardCovers) {
    const wildcard = values.find((branch) => branch?.kind === "parameter-wildcard" || branch?.kind === "wildcard-branch");
    if (wildcard) return [wildcard];
  }
  return values.sort((left, right) => stableStringify(semanticChoiceValue(left)).localeCompare(stableStringify(semanticChoiceValue(right))));
}
