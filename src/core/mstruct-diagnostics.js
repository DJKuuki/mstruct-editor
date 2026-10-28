function offsetToLineColumn(source, offset) {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

export function makeError(errors, source, code, start, end = start + 1, extra = {}) {
  const position = offsetToLineColumn(source, start);
  errors.push({ message: code, start, end: Math.max(end, start + 1), code, ...position, ...extra });
}
