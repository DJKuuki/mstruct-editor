import assert from "node:assert/strict";
import test from "node:test";
import { describeDuration, durationDisplayWidth } from "../src/core/duration-notation.js";
import { engraveMeasure } from "../src/core/engraving.js";
import { parseMstruct } from "../src/core/mstruct.js";

const value = (numerator, denominator = 1) => ({ numerator, denominator });
const notes = (numerator, denominator) => describeDuration(value(numerator, denominator));

test("非二进制分母使用连音数字和分子乘数", () => {
  for (const [denominator, basicDenominator] of [[3, 2], [5, 4], [6, 4], [11, 8]]) {
    assert.deepEqual(notes(1, denominator), {
      kind: "notes", fraction: `1/${denominator}`,
      notes: [{ denominator: basicDenominator, dots: 0, tuplet: denominator }], multiplier: 1,
    });
  }
  assert.deepEqual(notes(2, 3).multiplier, 2);
  assert.deepEqual(notes(7, 129), { kind: "fraction", fraction: "7/129" });
});

test("单个附点优先，其余分解为最多四个独立音符", () => {
  assert.deepEqual(notes(3, 4).notes, [{ denominator: 2, dots: 1, tuplet: null }]);
  assert.deepEqual(notes(7, 8).notes, [{ denominator: 2, dots: 2, tuplet: null }]);
  assert.deepEqual(notes(15, 16).notes, [{ denominator: 2, dots: 3, tuplet: null }]);
  assert.deepEqual(notes(5, 16).notes.map((note) => note.denominator), [4, 16]);
  assert.deepEqual(notes(11, 16).notes.map((note) => note.denominator), [2, 8, 16]);
  assert.deepEqual(notes(5, 2).notes.map((note) => note.denominator), [1, 1, 2]);
  assert.deepEqual(notes(3, 1).notes.map((note) => note.denominator), [1, 1, 1]);
});

test("五个以上音符改为乘法，基本音符范围外回退分数", () => {
  assert.deepEqual(notes(31, 32), {
    kind: "notes", fraction: "31/32",
    notes: [{ denominator: 32, dots: 0, tuplet: null }], multiplier: 31,
  });
  assert.deepEqual(notes(5, 1).multiplier, 5);
  assert.deepEqual(notes(1, 128), { kind: "fraction", fraction: "1/128" });
  assert.deepEqual(describeDuration(value(0, 1), "0"), { kind: "fraction", fraction: "0" });
});

test("分数与音符模式共用稳定宽度，不因切换而改变横向制谱", () => {
  assert.equal(durationDisplayWidth(value(11, 64), "note", "11/64"), durationDisplayWidth(value(11, 64), "fraction", "11/64"));
  for (const source of ["{BN:1}{TS:adlib}{D:11/64}C|;", "{BN:1}{TS:adlib}{D:11/64}X;"]) {
    const parsed = parseMstruct(source);
    assert.equal(parsed.ok, true);
    const fraction = engraveMeasure(parsed.measures[0]);
    const note = engraveMeasure(parsed.measures[0], { durationDisplayMode: "note" });
    assert.equal(note.slots[0].naturalWidth, fraction.slots[0].naturalWidth);
  }
});
