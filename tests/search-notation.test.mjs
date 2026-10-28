import assert from "node:assert/strict";
import test from "node:test";
import { parseMstruct } from "../src/core/mstruct.js";
import { projectMstructSearchEvents } from "../src/core/mstruct-search-events.js";
import { parseMstructSearchQuery } from "../src/core/mstruct-search-query.js";
import { matchMstructSearchQuery } from "../src/core/mstruct-search-match.js";

function compile(main) {
  const parsed = parseMstruct(`{BN:1}{D:1}{TS:adlib}${main}`);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  return projectMstructSearchEvents(parsed);
}
function hits(projection, source) {
  const query = parseMstructSearchQuery(source);
  assert.equal(query.ok, true, JSON.stringify(query.errors));
  return matchMstructSearchQuery(query, projection).windows.map((window) => window.startPosition);
}

test("complete chords use equivalent pitch sets by default and preserve final bass", () => {
  const projected = compile("Cm6|,Am7b5/C|,Am7b5|,Cm6/Eb|,G/C|,CM9no3|,CM9no3/G|;");
  for (const source of ["Cm6|*", "Am7b5/C|*"]) assert.deepEqual(hits(projected, source), [0, 1], source);
  for (const source of ["G/C|*", "CM9no3|*"]) assert.deepEqual(hits(projected, source), [4, 5], source);
  assert.deepEqual(hits(projected, "Cm6|* --notallowdifferentnotation"), [0]);
  assert.deepEqual(hits(projected, "Am7b5/C|* --notallowdifferentnotation"), [1]);
  assert.deepEqual(hits(projected, "G/C|* --notallowdifferentnotation"), [4]);
  assert.equal(parseMstructSearchQuery("Cm6|* --notallowdifferentnotation --notallowdifferentnotation").errors[0].code, "search-option-duplicate");
  assert.equal(parseMstructSearchQuery("Cm6|* --allowdifferentnotation").ok, false);
});

test("bass identity uses pitch class while explicit notes and strict notation retain spelling", () => {
  const projected = compile("C#m6|,Bbm7b5/Db|,C#m6/E|;");
  assert.deepEqual(hits(projected, "C#m6|*"), [0, 1]);
  assert.deepEqual(hits(projected, "C#m6|* --notallowdifferentnotation"), [0]);
  assert.deepEqual(hits(projected, "C#[notes:0,3,7,9]|*"), [0]);
});

test("equivalent relative chords share one offset based on final bass across the progression", () => {
  const projected = compile("Am7b5/C|,Bm7b5/D|,C#m7b5/E|,G/C|,DM9no3|;");
  assert.deepEqual(hits(projected, "(0)m6|*,(2)m6|*,(4)m6|*"), [0]);
  assert.deepEqual(hits(projected, "(-3)m7b5/(0)|*,(-1)m7b5/(2)|*,(1)m7b5/(4)|*"), [0]);
  assert.deepEqual(hits(projected, "(0)m6|*,(3)m6|*"), []);
  assert.deepEqual(hits(projected, "(0)m6|*,(2)m6|* --notallowdifferentnotation"), []);
  assert.deepEqual(hits(projected, "(7)/(0)|*,(2)M9no3|*"), [3]);
  assert.deepEqual(hits(projected, "(7)/(0)|*,(3)M9no3|*"), []);
});

test("fixed and relative root roles constrain the same offset without moving the fixed bass", () => {
  assert.deepEqual(hits(compile("D/A|,E|;"), "(0)/A|*,(2)|*"), [0]);
  assert.deepEqual(hits(compile("D/A|,E|;"), "(0)/G|*,(2)|*"), []);
  assert.deepEqual(hits(compile("C/A|,E|;"), "C/(7)|*,(2)|*"), [0]);
  assert.deepEqual(hits(compile("C/A|,D|;"), "C/(7)|*,(2)|*"), []);
  const strict = parseMstructSearchQuery("C/(7)|* --notallowdifferentnotation");
  assert.ok(strict.events[0].harmony.chord.anchorMasks.length);
});

test("one finite field OR compiles alternatives without losing relative or absolute branches", () => {
  const projected = compile("Am7b5/C|,CM9no3|,Dm|;");
  assert.deepEqual(hits(projected, "(Cm6||G/C)|*"), [0, 1]);
  assert.deepEqual(hits(projected, "C(m6||M9no3)|*"), [0, 1]);
  assert.deepEqual(hits(projected, "(Cm6||(2)m6)|*,(5)m|*"), []);
  assert.deepEqual(hits(compile("Cm6|,Dm|;"), "(Cm6||(2)m6)|*,(5)m|*"), [0]);
  assert.deepEqual(hits(projected, "(Cm6||G/C)|* --notallowdifferentnotation"), []);
});

test("NOT applies equivalent notation to every alternative and the opt-out restores source matching", () => {
  const projected = compile("Am7b5/C|,Am7b5|,C\\\\Am7b5/C|;");
  assert.deepEqual(hits(projected, "*!(Cm6)|*"), [1]);
  assert.deepEqual(hits(projected, "*!(Cm6)|* --notallowdifferentnotation"), [0, 1, 2]);
  assert.equal(parseMstructSearchQuery("* !((0)m6)|*").ok, false);
});

test("source wildcard patterns and independent OR groups keep their existing meaning", () => {
  const projected = compile("Cm6|,Am7b5/C|,Cm7|,Cm9|;");
  assert.deepEqual(hits(projected, "Cm6*|*"), [0]);
  assert.deepEqual(hits(projected, "Cm7*|*"), [2]);
  assert.equal(parseMstructSearchQuery("(C||D)(m6||m7)|*").events[0].harmony.chord.kind, "choice-pattern");
  assert.deepEqual(hits(projected, "C[notes:0,3,7,9]|* --notallowdifferentnotation"), [0, 1]);
});
