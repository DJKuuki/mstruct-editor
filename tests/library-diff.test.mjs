import assert from "node:assert/strict";
import test from "node:test";
import { buildLibraryDiff } from "../src/ui/library-diff.js";

function reconstruct(rows, side) {
  const cells = rows.map(row => row[side]).filter(Boolean);
  assert.deepEqual(cells.map(cell => cell.number), cells.map((_, i) => i + 1));
  for (const cell of cells) assert.equal(cell.parts.map(part => part.text).join(""), cell.text);
  return cells.map(cell => cell.text).join("\n");
}

test("inserted and removed lines align unchanged content and retain independent line numbers", () => {
  const local = "header\nremoved\nanchor\ntail", remote = "header\nanchor\nadded\ntail";
  const rows = buildLibraryDiff(local, remote);
  assert.equal(reconstruct(rows, "local"), local); assert.equal(reconstruct(rows, "remote"), remote);
  assert.deepEqual(rows.filter(row => !row.changed).map(row => row.local.text), ["header", "anchor", "tail"]);
  assert.deepEqual(rows.map(row => [row.local?.number ?? null, row.remote?.number ?? null]), [[1, 1], [2, null], [3, 2], [null, 3], [4, 4]]);
});

test("paired lines highlight separate character edits without splitting Unicode code points", () => {
  const local = "前言🙂 C|I Dm|ii; <script>", remote = "前言🎵 C|V Dm|IV; <script>";
  const [row] = buildLibraryDiff(local, remote);
  assert.equal(row.changed, true);
  assert.equal(reconstruct([row], "local"), local); assert.equal(reconstruct([row], "remote"), remote);
  assert.deepEqual(row.local.parts.filter(part => part.changed).map(part => part.text), ["🙂", "I", "ii"]);
  assert.deepEqual(row.remote.parts.filter(part => part.changed).map(part => part.text), ["🎵", "V", "IV"]);
  assert.ok(row.local.parts.some(part => !part.changed && part.text.includes("<script>")));
});

test("empty files, missing local files, blank lines and final newline differences stay distinct", () => {
  assert.equal(buildLibraryDiff("", "")[0].changed, false);
  const missing = buildLibraryDiff(null, "");
  assert.equal(missing[0].local, null); assert.equal(missing[0].remote.number, 1); assert.equal(missing[0].changed, true);
  const rows = buildLibraryDiff("A\n\nB", "A\n\nB\n");
  assert.equal(reconstruct(rows, "local"), "A\n\nB"); assert.equal(reconstruct(rows, "remote"), "A\n\nB\n");
  assert.equal(rows.at(-1).local, null); assert.equal(rows.at(-1).changed, true);
  assert.ok(buildLibraryDiff("A\r\nB", "A\nB").every(row => !row.changed));
});

test("repeated musical lines and varied edit sequences reconstruct both original files", () => {
  let seed = 19;
  const random = max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  for (let i = 0; i < 150; i++) {
    const local = Array.from({ length: random(35) + 1 }, () => ["C|I;", "G|V;", "", "Dm|ii;", "{BN:1}"][random(5)]).join("\n");
    const remote = Array.from({ length: random(35) + 1 }, () => ["C|I;", "G|V;", "", "Dm|ii;", "{BN:1}"][random(5)]).join("\n");
    const rows = buildLibraryDiff(local, remote);
    assert.equal(reconstruct(rows, "local"), local); assert.equal(reconstruct(rows, "remote"), remote);
    for (const row of rows.filter(row => !row.changed)) assert.equal(row.local.text, row.remote.text);
  }
});

test("large sparse edits keep their anchors; unrelated files and long lines use a bounded fallback", () => {
  const lines = Array.from({ length: 6000 }, (_, i) => `line ${i}`), changed = [...lines];
  changed[10] += " edited"; changed[5500] += " edited";
  const rows = buildLibraryDiff(lines.join("\n"), changed.join("\n"));
  assert.equal(rows.filter(row => row.changed).length, 2);
  const local = lines.join("\n"), remote = lines.map(text => `other ${text}`).join("\n");
  const unrelated = buildLibraryDiff(local, remote);
  assert.equal(reconstruct(unrelated, "local"), local); assert.equal(reconstruct(unrelated, "remote"), remote);
  const long = buildLibraryDiff("a".repeat(100001), "b".repeat(100001));
  assert.equal(long[0].local.parts.length, 1); assert.equal(long[0].remote.parts.length, 1);
});
