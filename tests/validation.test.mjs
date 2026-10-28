import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseMstruct } from "../src/core/mstruct.js";
import { addRational, parseFraction, rational, RationalRangeError } from "../src/core/mstruct-rational.js";
import { buildPlaybackPlan } from "../src/core/mstruct-playback.js";
import { parseMstructSearchQuery } from "../src/core/mstruct-search-query.js";
import { parseRomanConfigCsv, parseRomanSymbol } from "../src/core/roman-symbol.js";
import { parseGlobalTagList, parseSemanticTagConfigCsv } from "../src/core/semantic-tags.js";
import { romanSymbolModel } from "../src/core/symbol-render-model.js";
import { syntaxErrorMessage } from "../src/editor-i18n.js";

const readConfig = (name) => readFile(new URL(`../src/config/${name}.csv`, import.meta.url), "utf8");
const [basicCsv, advancedCsv, figuredBassCsv, specialCsv, cadenceCsv, tonalCsv, sequenceCsv] = await Promise.all(
  ["roman-basic", "roman-advanced", "roman-figured-bass", "roman-special", "cadence-tags", "tonal-tags", "sequence-tags"].map(readConfig),
);
const romanConfig = parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv });
const semanticTagConfig = parseSemanticTagConfigCsv({ cadenceCsv, tonalCsv, sequenceCsv }, { romanConfig });
const options = { romanConfig, semanticTagConfig };
const parse = (source, extra = {}) => parseMstruct(source, { ...options, ...extra });
const checkValid = (result) => assert.equal(result.ok, true, result.errors.map((error) => `${error.code}: ${error.message}`).join("\n"));

test("ordinary final measures require a semicolon, including after whitespace and complete measures", () => {
  for (const tail of ["X", "[C:C]", "X,", "X\n", "X;X"]) {
    const result = parse(`{BN:1}{TS:adlib}{D:1}${tail}`);
    assert.equal(result.ok, false, tail);
    assert.ok(result.errors.some((error) => error.code === "measure-unfinished"), tail);
    assert.deepEqual(result.playbackRoute, [], tail);
  }
  for (const source of ["{BN:1}{TS:adlib}{D:1}X;", "{BN:1}{TS:adlib}{D:1/4}X,X,X,X;{LB}", "{BN:1}{TS:adlib}{D:1/4}X...", "{BN:1}{TS:adlib}{D:1}X;..."]) {
    checkValid(parse(source));
  }
  const unclosed = parse("{BN:1}{TS:adlib}{D:1}[C:C");
  assert.equal(unclosed.ok, false);
  assert.equal(unclosed.errors.some((error) => error.code === "measure-unfinished"), false);
});

test("BPM and BPMhidden reject zero, unsafe beat fractions and nonfinite tempo before playback", () => {
  for (const type of ["BPM", "BPMhidden"]) {
    for (const value of ["0/4=120", "1/0=120", "1/4=0", "1/4=0.0", "1/4=-1", "1/4=1e2", "9007199254740992/4=120", `1/4=${"9".repeat(400)}`]) {
      const result = parse(`{BN:1}{TS:adlib}{D:1}{${type}:${value}}X;`, { isStableTempo: true });
      assert.ok(result.errors.some((error) => error.code === "invalid-bpm"), `${type}: ${value}`);
      assert.deepEqual(result.playbackRoute, []);
    }
    const valid = parse(`{BN:1}{TS:adlib}{D:1}{${type}:2/8=120.5}X;`, { isStableTempo: true });
    checkValid(valid);
    assert.equal(valid.playbackRoute[0].parts[0].bpm, "2/8=120.5");
    assert.ok(buildPlaybackPlan(valid).entries.length > 0);
  }
  const retained = parse("{BN:1}{TS:adlib}{D:1}{BPM:1/4=90}{BPMhidden:1/0=120}X;");
  assert.deepEqual(retained.measures[0].slots[0].settings.filter((setting) => setting.type.startsWith("BPM")).map((setting) => setting.value), ["1/4=90"]);
});

test("D and shorthand require positive exact fractions, while internal rational zero remains valid", () => {
  for (const value of ["0", "0/4", "1/0", "9007199254740992", "1/9007199254740992", "9".repeat(400)]) {
    for (const token of [`{D:${value}}`, `{${value}}`]) {
      const result = parse(`{BN:1}{TS:adlib}${token}X;`);
      assert.ok(result.errors.some((error) => error.code === "invalid-division"), token);
    }
  }
  for (const token of ["{D:1}", "{1}", "{D:1/1}", "{1/1}"]) checkValid(parse(`{BN:1}{TS:adlib}${token}X;`));
  checkValid(parse("{BN:1}{TS:adlib}{1/4}X,X,X,X;"));
  assert.deepEqual(parseFraction("0/4"), rational(0));
  assert.equal(parseFraction("1/0"), null);
  assert.deepEqual(addRational(rational(1, 9007199254740991), rational(9007199254740990, 9007199254740991)), rational(1));
  assert.throws(() => addRational(rational(9007199254740991), rational(1)), RationalRangeError);
  for (const source of ["{BN:1}{TS:adlib}{D:9007199254740991}X,X;", "{BN:1}{TS:adlib}{D:9007199254740991}X,,;"]) {
    const result = parse(source);
    assert.ok(result.errors.some((error) => error.code === "invalid-duration-range"));
    assert.deepEqual(result.playbackRoute, []);
  }
});

test("MM ratios reduce before range checks and never retain a stale BPM on overflow", () => {
  const large = "9007199254740991";
  const canceled = parse(`{BN:1}{TS:adlib}{D:1}{BPM:1/${large}=60}{MM:1/${large}=1/4}X;`, { isStableTempo: true });
  checkValid(canceled);
  assert.equal(canceled.playbackRoute[0].parts[0].bpm, "1/4=60");
  const main = `{BN:1}{TS:adlib}{D:1}{BPM:1/${large}=60}{MM:1/2=1/4}X;`;
  const unknown = parse(main);
  checkValid(unknown);
  assert.equal(unknown.playbackRoute[0].parts[0].bpm, null);
  assert.equal(buildPlaybackPlan(unknown).ready, false);
  assert.ok(parse(main, { isStableTempo: true }).errors.some((error) => error.code === "missing-stable-tempo"));
});

test("T preserves reading labels in minute and hour formats with both delimiters", () => {
  for (const value of ["0:60", "0:99", "0:5", "0:005", "-1:00", "1:60:00", "1:0:00", "1:00:60", "1:00:0", "1:00:00:00", "0:00.5"]) {
    const result = parse(`{BN:1}{TS:adlib}{D:1}{T=${value}}X;`);
    assert.ok(result.errors.some((error) => error.code === "invalid-time"), value);
  }
  for (const delimiter of [":", "="]) {
    for (const value of ["0:00", "00:59", "120:01", "1:00:00", "12:34:56", "00:01:02", "9007199254740991:00"]) {
      const result = parse(`{BN:1}{TS:adlib}{D:1}{T${delimiter}${value}}X;`);
      checkValid(result);
      assert.equal(result.measures[0].slots[0].annotations.time, value);
    }
  }
  checkValid(parse("{BN:1}{TS:adlib}{D:1}{T=120:00}X;{T=0:01}X;"));
});

test("TC and all Centricity entry points reject double accidentals and retain ordinary/Ambi centers", () => {
  for (const note of ["Fx", "Bbb", "f##"]) {
    for (const value of [note, `"${note}"`]) {
      assert.equal(parse(`{BN:1}{TS:adlib}{D:1}{TC:${value}}X;`).ok, false, value);
      for (const token of [`</Centricity:${value}>`, `<Centricity:${value}>`]) {
        assert.equal(parse(`{BN:1}{TS:adlib}{D:1}${token}X;`).ok, false, token);
      }
      assert.equal(parseGlobalTagList(`</Centricity:${value}>`, options).ok, false);
      for (const query of [`<Centricity:${value}>*|*`, `<Centricity:(${value}||C)>*|*`, `{TC:${value}}*|*`]) {
        assert.equal(parseMstructSearchQuery(query, options).ok, false, query);
      }
    }
  }
  for (const value of ["F#", "bb", '"f#"', '"Bb"']) {
    checkValid(parse(`{BN:1}{TS:adlib}{D:1}{TC:${value}}X;`));
    checkValid(parse(`{BN:1}{TS:adlib}{D:1}</Centricity:${value}>X;`));
    checkValid(parse(`{BN:1}{TS:adlib}{D:1/2}<Centricity:${value}>X,</Centricity>X;`));
    checkValid(parseGlobalTagList(`</Centricity:${value}>`, options));
    checkValid(parseMstructSearchQuery(`<Centricity:(${value}||C)>*|*`, options));
  }
  checkValid(parse("{BN:1}{TS:adlib}{D:1/2}</Mode_Dorian:Fx>X,</Scale_WholeTone:Bbb>X;"));
  for (const value of ["*", '"*"', "?", '"?"']) checkValid(parseMstructSearchQuery(`<Centricity:${value}>*|*`, options));
});

test("approved Roman extensions retain their mode, quality and exact degree structures", () => {
  const cases = [
    ["IIDM7", "M", ["2", "#4", "6", "1"]],
    ["niiiho7", "m", ["3", "5", "b7", "2"]],
    ["iiiho7", "M", ["3", "5", "b7", "2"]],
    ["bVIIDM7", "M", ["b7", "2", "4", "b6"]],
    ["VM7", "M", ["5", "7", "2", "#4"]],
    ["bIII+7", "M", ["b3", "5", "7", "2"]],
    ["bIIIDM7", "M", ["b3", "5", "b7", "b2"]],
    ["ivM7", "M", ["4", "b6", "1", "3"]],
  ];
  for (const [source, tonalMode, structure] of cases) {
    const result = parseRomanSymbol(source, { config: romanConfig, tonalMode });
    assert.deepEqual(result.structure.values, structure, source);
    checkValid(parse(`{BN:1}{TS:adlib}{D:1}{TC:${tonalMode === "m" ? "c" : "C"}}|${source};`));
  }
  for (const [source, tonalMode] of [["niiiho7", "M"], ["iiiho7", "m"]]) {
    assert.throws(() => parseRomanSymbol(source, { config: romanConfig, tonalMode }), source);
  }
  for (const source of ["IIIDM7", "VIDM7"]) {
    assert.equal(parseRomanSymbol(source, { config: romanConfig }).warnings.length, 1);
  }
});

test("M and ordinary oM permit seventh inversions while triad figures and specials stay restricted", () => {
  for (const [base, notes] of [["VM", ["5", "7", "2", "#4"]], ["iM", ["1", "b3", "5", "7"]], ["ivM", ["4", "b6", "1", "3"]], ["ioM", ["1", "b3", "b5", "7"]]]) {
    for (const [figure, inversion, upper, lower] of [["65", 1, "6", "5"], ["43", 2, "4", "3"], ["42", 3, "4", "2"]]) {
      const result = parseRomanSymbol(`${base}${figure}`, { config: romanConfig, tonalMode: "M" });
      assert.deepEqual(result.structure.values, [...notes.slice(inversion), ...notes.slice(0, inversion)]);
      assert.deepEqual([result.figure.upper, result.figure.lower], [upper, lower]);
      const model = romanSymbolModel(result);
      const stack = model.children.find((node) => node.className?.split(" ").includes("score-roman-figures"));
      assert.deepEqual(stack.children.map((row) => row.children.find((node) => node.className === "score-roman-figure-number").children.join("")), [upper, lower]);
    }
  }
  for (const source of ["VM", "VM6", "VM64", "VMsus", "ioM", "ioM6", "ioM64", "ioM7sus", "viioM65", "viioM43", "viioM42"]) {
    assert.throws(() => parseRomanSymbol(source, { config: romanConfig, tonalMode: "M" }), source);
  }
});

test("forward BN jumps continue automatic numbering; duplicate/backward numbers remain invalid", () => {
  const result = parse("{BN:1}{TS:adlib}{D:1}X;{BN:5}X;X;");
  checkValid(result);
  assert.deepEqual(result.measures.map((measure) => measure.barNumber), [1, 5, 6]);
  for (const next of ["1", "0"]) {
    assert.ok(parse(`{BN:1}{TS:adlib}{D:1}X;{BN:${next}}X;`).errors.some((error) => error.code === "bar-number-backward"));
  }
});

test("new shared diagnostics provide source ranges and distinct Chinese/English copy", () => {
  for (const [source, code] of [["{BN:1}{TS:adlib}{D:1}X", "measure-unfinished"], ["{BN:1}{TS:adlib}{D:9007199254740991}X,X;", "invalid-duration-range"]]) {
    const result = parse(source);
    const error = result.errors.find((entry) => entry.code === code);
    assert.ok(error.start >= 0 && error.end > error.start && error.end <= source.length);
    assert.notEqual(syntaxErrorMessage(error, "zh"), syntaxErrorMessage(error, "en"));
    assert.match(syntaxErrorMessage(error, "zh"), /小节|时值/);
  }
});
