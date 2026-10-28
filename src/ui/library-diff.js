// Bounded Myers comparison: unchanged runs anchor both columns without an N×M matrix.
// Very large unrelated blocks fall back to whole-block highlighting.
function compare(a, b, budget = 150000) {
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const left = a.slice(start, a.length - end), right = b.slice(start, b.length - end);
  const prefix = a.slice(0, start).map(text => ({ type: "equal", text }));
  const suffix = end ? a.slice(-end).map(text => ({ type: "equal", text })) : [];
  const fallback = () => [...left.map(text => ({ type: "delete", text })), ...right.map(text => ({ type: "insert", text }))];
  if (!left.length || !right.length) return [...prefix, ...fallback(), ...suffix];
  const frontier = new Map([[1, 0]]), trace = [];
  let cost = 0;
  for (let depth = 0; depth <= left.length + right.length; depth++) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      if (++cost > budget) return [...prefix, ...fallback(), ...suffix];
      let x = diagonal === -depth || (diagonal !== depth && frontier.get(diagonal - 1) < frontier.get(diagonal + 1))
        ? frontier.get(diagonal + 1) : frontier.get(diagonal - 1) + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) { x++; y++; if (++cost > budget) return [...prefix, ...fallback(), ...suffix]; }
      frontier.set(diagonal, x);
      if (x < left.length || y < right.length) continue;
      const edits = [];
      for (let d = depth; d >= 0; d--) {
        const previous = trace[d], k = x - y;
        const previousK = k === -d || (k !== d && previous.get(k - 1) < previous.get(k + 1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
        while (x > previousX && y > previousY) { edits.push({ type: "equal", text: left[--x] }); y--; }
        if (!d) break;
        if (x === previousX) edits.push({ type: "insert", text: right[--y] });
        else edits.push({ type: "delete", text: left[--x] });
      }
      return [...prefix, ...edits.reverse(), ...suffix];
    }
  }
  return [...prefix, ...fallback(), ...suffix];
}

function characterParts(left, right) {
  const edits = left.length + right.length <= 100000
    ? compare(Array.from(left), Array.from(right), 20000)
    : [{ type: "delete", text: left }, { type: "insert", text: right }];
  const parts = [[], []];
  for (const edit of edits) for (let side = 0; side < 2; side++) {
    if (edit.type === (side ? "delete" : "insert")) continue;
    const changed = edit.type !== "equal", previous = parts[side].at(-1);
    if (previous?.changed === changed) previous.text += edit.text;
    else parts[side].push({ text: edit.text, changed });
  }
  return parts;
}

/** null means a missing file; an empty string is an existing, empty file. */
export function buildLibraryDiff(local, remote) {
  const lines = text => text === null ? [] : String(text).replace(/\r\n?/g, "\n").split("\n");
  const edits = compare(lines(local), lines(remote)), rows = [];
  let localNumber = 0, remoteNumber = 0, removed = [], added = [];
  function flush() {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const left = removed[i], right = added[i];
      const parts = left !== undefined && right !== undefined ? characterParts(left, right) : null;
      const cell = (text, number, side) => text === undefined ? null : { text, number, parts: parts?.[side] ?? [{ text, changed: true }] };
      rows.push({ changed: true, local: cell(left, left === undefined ? null : ++localNumber, 0), remote: cell(right, right === undefined ? null : ++remoteNumber, 1) });
    }
    removed = []; added = [];
  }
  for (const edit of edits) {
    if (edit.type === "delete") removed.push(edit.text);
    else if (edit.type === "insert") added.push(edit.text);
    else {
      flush();
      const parts = [{ text: edit.text, changed: false }];
      rows.push({ changed: false, local: { text: edit.text, number: ++localNumber, parts }, remote: { text: edit.text, number: ++remoteNumber, parts } });
    }
  }
  flush();
  return rows;
}

export function createLibraryDiff({ local, remote, copy }) {
  const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const container = node("div", "library-diff"), headings = node("div", "library-diff-headings");
  headings.append(node("strong", "", copy("current")), node("strong", "", copy("remote")));
  const scroll = node("div", "library-diff-scroll"); scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", copy("diffLabel"));
  if (local === null) container.append(node("p", "library-diff-missing", copy("missing")));
  for (const row of buildLibraryDiff(local, remote)) {
    const line = node("div", `library-diff-row${row.changed ? " is-changed" : ""}`);
    for (const [side, cell] of [["local", row.local], ["remote", row.remote]]) {
      const column = node("div", `library-diff-cell${cell ? "" : " is-gap"}`);
      column.setAttribute("aria-label", copy(side === "local" ? "current" : "remote"));
      const number = node("span", "library-diff-number", cell?.number ?? ""); number.setAttribute("aria-hidden", "true");
      const content = node("pre", "library-diff-code");
      if (cell) {
        column.title = copy("diffLine", { line: cell.number });
        if (row.changed) column.title += ` · ${copy(!row.local ? "diffAdded" : !row.remote ? "diffRemoved" : "diffChanged")}`;
        for (const part of cell.parts) content.append(node(part.changed ? "mark" : "span", "", part.text));
      }
      column.append(number, content); line.append(column);
    }
    scroll.append(line);
  }
  container.append(node("p", "library-diff-help", copy("diffHelp")), headings, scroll);
  return container;
}
