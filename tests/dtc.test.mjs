import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseMstruct } from "../src/core/mstruct.js";
import { parseDtcPair } from "../src/core/mstruct-dtc.js";
import { parseProfileConfig } from "../src/core/profile-config.js";
import { PROFILE_FILES } from "../src/core/profile-schema.js";
import { parseGlobalTagList, tagDisplayParts } from "../src/core/semantic-tags.js";
import { projectMstructSearchEvents, MSTRUCT_SEARCH_INDEX_FORMAT_VERSION } from "../src/core/mstruct-search-events.js";
import { parseMstructSearchQuery } from "../src/core/mstruct-search-query.js";
import { matchMstructSearchQuery } from "../src/core/mstruct-search-match.js";
import { buildPlaybackPlan, buildMstructtimePlaybackPlan } from "../src/core/mstruct-playback.js";
import { playbackEntryInformation } from "../src/core/mstruct-playback-info.js";
import { toolboxTemplateWitness } from "../src/core/profile-toolbox.js";
import { tagIsVisible } from "../src/core/renderer-layers.js";
import { createMstructProfile } from "../src/core/profile.js";
import { assignDocumentProfile, compileProfileDocument } from "../src/core/profile-document.js";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { compileMstructScore } from "../src/core/score-embed.js";

const files = Object.fromEntries(await Promise.all(PROFILE_FILES.map(async ({ name }) =>
  [name, await readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8")])));
const config = parseProfileConfig(files);
const prefix = "{BN:1}{TS:adlib}{D:1/4}{TC:C}{BPM:1/4=60}";
function parse(body, before = prefix) {
  const result = parseMstruct(before + body, { ...config, isStableTempo: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
}
const slots = (result) => result.measures.flatMap((measure) => measure.slots);
const dtc = (tags) => tags.filter((tag) => tag.semanticKind === "dtc").map((tag) => tag.token);
function matches(result, source) {
  const query = parseMstructSearchQuery(source, config);
  assert.equal(query.ok, true, JSON.stringify(query.errors));
  return matchMstructSearchQuery(query, projectMstructSearchEvents(result)).windows;
}

test("DTC preserves any source order and accepts relative, parallel and chromatic pairs", () => {
  for (const pair of ["a,C", "C,a", "C,c", "c,C", "C#,E", "E,C#", "C,F#", "F#,C", "c#,eb"]) {
    assert.deepEqual(parseDtcPair(pair), pair.split(","));
    const tag = slots(parse(`<DTC:${pair}>C|I;`))[0].tags[0];
    assert.equal(tag.token, `<DTC:${pair}>`);
    assert.equal(tag.enParts[0].type, "literal", "English prose must not be converted to music accidentals");
    for (const locale of ["zh", "en"]) {
      assert.deepEqual(tagDisplayParts(tag, locale).filter((part) => part.type === "note").map((part) => part.value), pair.split(","));
    }
    assert.equal(tagIsVisible(tag, { tags: true, form: false }), true);
  }
});

test("DTC inherits, replaces and clears without a restoration stack or required close", () => {
  const result = parse("<DTC:C,a>C|I,D|ii,<DTC:C#,E>E|III,F|IV,</DTC>G|V,A|vi;");
  assert.deepEqual(slots(result).map((slot) => slot.activeDtc?.token ?? null),
    ["<DTC:C,a>", "<DTC:C,a>", "<DTC:C#,E>", "<DTC:C#,E>", null, null]);
  assert.deepEqual(projectMstructSearchEvents(result).events.map((event) => dtc(event.tags)),
    [["<DTC:C,a>"], ["<DTC:C,a>"], ["<DTC:C#,E>"], ["<DTC:C#,E>"], [], []]);
  assert.ok(parse("<DTC:a,C>C|I;").ok);
  assert.ok(parse("</DTC>C|I;").ok, "clear is idempotent, including after skipped endings");
  const sameSlot = parse("<DTC:a,C><DTC:C#,E></DTC>C|I;");
  assert.deepEqual(dtc(projectMstructSearchEvents(sameSlot).events[0].tags), []);
});

test("DTC never supplies, changes, clears or constrains TC and Roman", () => {
  const result = parse("<DTC:a,C>Am|vi,{TC:a}Am|i,<DTC:C#,E>Am|i,</DTC>Am|i;");
  assert.deepEqual(slots(result).map((slot) => slot.events[0].tonalCenter), ["C", "a", "a", "a"]);
  assert.equal(parseMstruct("{BN:1}{TS:adlib}{D:1}<DTC:a,C>Am|i;", config).ok, false);
  assert.ok(parse("<DTC:a,C>Am|;", prefix.replace("{TC:C}", "{TC:None}")).ok);
  assert.equal(parseMstruct(prefix.replace("{TC:C}", "{TC:None}") + "<DTC:a,C>Am|i;", config).ok, false);
  assert.ok(parse('<DTC:a,C><Mode_Dorian:d>{M:G|V}G|V&I{/M},</Mode_Dorian></DTC>G|I;').ok);
  assert.ok(parse('<Centricity:"C"><DTC:a,C>Am|vi,</DTC></Centricity>C|I;').ok);
});

test("DTC rejects invalid arity, provisional refs, nonconcrete source values and duplicate tonics", () => {
  for (const pair of ["", ",", "C", "C,a,G", "C,", ",a", "C, a", "C,C", "C,B#", "M,m", "C,*", '"C",a', "None,a", "C,ax"]) {
    assert.equal(parseDtcPair(pair), null, pair);
    const result = parseMstruct(prefix + `<DTC:${pair}>C|I;`, config);
    assert.equal(result.ok, false, pair);
    assert.ok(result.errors.some((error) => error.domain === "tag"), pair);
  }
  for (const body of ["<DTC>C|I;", "</DTC:a,C>C|I;", "<*/DTC>C|I;", "<DTC:a,C>;"]) {
    assert.equal(parseMstruct(prefix + body, config).ok, false, body);
  }
});

test("DTC search matches unordered concrete and mode pairs and supports finite OR", () => {
  const result = parse("<DTC:C,a>Am|vi,F|IV,<DTC:C,c>Cm|i,<DTC:E,C#>E|III,<DTC:eb,c#>Ebm|biii,</DTC>C|I;");
  for (const source of ["<DTC:a,C>", "<DTC:C,a>", "<DTC:C,a>Am|vi,<DTC:a,C>F|IV"]) {
    assert.equal(matches(result, source).length, source.includes("Am|") ? 1 : 2, source);
  }
  assert.equal(matches(result, "<DTC:M,m>").length, 3);
  assert.equal(matches(result, "<DTC:m,M>").length, 3);
  assert.equal(matches(result, "<DTC:M,M>").length, 1);
  assert.equal(matches(result, "<DTC:m,m>").length, 1);
  assert.equal(matches(result, "<DTC:C,?>").length, 3);
  assert.equal(matches(result, "<DTC:*,*>").length, 5);
  assert.equal(matches(result, "<DTC:(a,C||C#,E)>").length, 3);
  assert.deepEqual(parseMstructSearchQuery("<DTC:a,C>", config).events,
    parseMstructSearchQuery("<DTC:C,a>", config).events);
  assert.equal(matches(result, "<DTC:a,C>{TC:m}").length, 0, "DTC does not alter TC search");
  for (const query of ["<DTC>", "</DTC>", "<DTC:M>", "<DTC:M,m,*>", '<DTC:"C",a>', "<DTC:C,C>"]) {
    assert.equal(parseMstructSearchQuery(query, config).ok, false, query);
  }
});

test("GLOBAL_TAGS accepts one concrete DTC pair with normal global syntax", () => {
  const global = parseGlobalTagList("</DTC:a,C>", config);
  assert.equal(global.ok, true, JSON.stringify(global.errors));
  assert.deepEqual(global.tags.map(tag => tag.token), ["<DTC:a,C>"]);
  assert.deepEqual(tagDisplayParts(global.tags[0], "en").filter(part => part.type === "note").map(part => part.value), ["a", "C"]);
  for (const source of ["</DTC>", "<DTC:a,C>", "</DTC:M,m>", "</DTC:C,C>", "</DTC:a,C></DTC:C,a>", "</DTC:a,C></DTC:E,C#>"]) {
    assert.equal(parseGlobalTagList(source, config).ok, false);
  }
});

test("global DTC is active for search and both playback models and forbids every MAIN DTC command", () => {
  const globalTags = parseGlobalTagList("</DTC:a,C>", config).tags;
  const result = parseMstruct(prefix + "{||:}C|I,D|ii{:||};E|III;...{BN:8}F|IV;", { ...config, globalTags });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.playbackRoute.every(visit => visit.dtcTag.token === "<DTC:a,C>"));
  const projected = projectMstructSearchEvents(result);
  assert.equal(projected.globalTags.filter(tag => tag.semanticKind === "dtc").length, 1);
  assert.ok(projected.events.every(event => !event.tags.some(tag => tag.semanticKind === "dtc")));
  for (const source of ["<DTC:C,a>", "<DTC:M,m>", "*|* --globaltag:<DTC:C,a>", "*|* --globaltag:<DTC:M,m>"]) {
    assert.equal(matches(result, source).length, 4, source);
  }
  const onlyLocal = parse("<DTC:a,C>C|I;");
  assert.equal(matches(onlyLocal, "*|* --globaltag:<DTC:C,a>").length, 0);
  assert.ok(buildPlaybackPlan(result).entries.every(entry => dtc(playbackEntryInformation(entry).activeTags)[0] === "<DTC:a,C>"));
  for (const token of ["<DTC:a,C>", "<DTC:C#,E>", "</DTC>", "</DTC:a,C>", "<*/DTC>"]) {
    const source = prefix + token + "C|I;";
    const invalid = parseMstruct(source, { ...config, globalTags });
    const error = invalid.errors.find(item => item.code === "global-dtc-main-conflict");
    assert.equal(invalid.ok, false, token);
    assert.equal(source.slice(error.start, error.end), token);
    assert.deepEqual(invalid.playbackRoute, []);
  }
  const timed = parseMstruct(prefix.replace("adlib", "2/4") + "C|I,D|ii;", { ...config, globalTags });
  const plan = buildMstructtimePlaybackPlan(timed, { metadata: { musicLength: "0:05" }, loop: "1,2/4,1,1,1/4;", main: "{BN:1}{TS:2/4}{D:1/4}[0,1][2000,2],[1000,1][3000,2];" });
  assert.equal(plan.ready, true, JSON.stringify(plan.errors));
  assert.ok(plan.entries.every(entry => dtc(playbackEntryInformation(entry).activeTags)[0] === "<DTC:a,C>"));
});

test("DTC remains reserved against ordinary and form configuration", () => {
  for (const name of ["tags.csv", "form-tags.csv"]) {
    const row = name === "tags.csv" ? '"<DTC:a,C>",冲突,Conflict,1\n' : '"<DTC:a,C>",冲突,Conflict,1,,1,0\n';
    assert.throws(() => parseProfileConfig({ ...files, [name]: files[name] + row }), (error) => error.code === "profile-tag-conflict");
  }
  for (const insertion of ["<DTC:>", "<DTC:,>", "</DTC>"]) {
    assert.ok(parseMstruct(toolboxTemplateWitness(insertion, config), config).ok);
  }
});

test("Renderer Test enforces metadata DTC across exact-profile and score-embedding compilation", async () => {
  const source = await readFile(new URL("./fixtures/renderer-global-forms-dtc.mstruct", import.meta.url), "utf8");
  const profile = await createMstructProfile({ profileId: "org.mstruct.official/rulesets/2.0.0", files });
  const assigned = await assignDocumentProfile(source, profile);
  assert.equal(assigned.ok, true, JSON.stringify(assigned.errors));
  const result = compileProfileDocument(assigned.document, profile);
  const embedding = compileMstructScore(source, { ...config, sourceKind: "document" });
  for (const compiled of [result, embedding]) {
    assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
    assert.equal(compiled.globalTags.length, 2);
    assert.ok(buildPlaybackPlan(compiled).entries.every(entry => {
      const tags = playbackEntryInformation(entry).activeTags;
      return tags.some(tag => tag.token === "<Sonata_Form>") && tags.some(tag => tag.token === "<DTC:a,C>");
    }));
  }
  const invalid = source.replace("C|I", "<DTC:a,C>C|I");
  const document = parseMstructDocument(invalid);
  const bound = { ...document, metadata: assigned.document.metadata };
  for (const compiled of [compileProfileDocument(bound, profile), compileMstructScore(invalid, { ...config, sourceKind: "document" })]) {
    assert.equal(compiled.ok, false);
    assert.ok(compiled.errors.some(error => error.code === "global-dtc-main-conflict"));
  }
});

test("actual repeat/ending visits restore DTC and skip unperformed replacement or end commands", () => {
  const result = parse("<DTC:a,C>{||:}C|I;{ENDING:1}<DTC:C#,E>D|ii{/ENDING:1}{:||};{ENDING:2}E|III{/ENDING};F|IV;", prefix.replace("adlib", "1/4"));
  const expected = ["<DTC:a,C>", "<DTC:C#,E>", "<DTC:a,C>", "<DTC:a,C>", "<DTC:a,C>"];
  assert.deepEqual(result.playbackRoute.map((entry) => entry.dtcTag?.token ?? null), expected);
  const projection = projectMstructSearchEvents(result);
  assert.equal(projection.formatVersion, MSTRUCT_SEARCH_INDEX_FORMAT_VERSION);
  assert.deepEqual(projection.segments[0].map((position) => dtc(projection.events[position].tags)[0]), expected);
  assert.equal(matches(result, "<DTC:a,C>E|III,<DTC:C,a>F|IV").length, 1);
  assert.equal(matches(result, "<DTC:C#,E>E|III").length, 0);
  assert.deepEqual(buildPlaybackPlan(result).entries.map((entry) => dtc(playbackEntryInformation(entry).activeTags)[0]), expected);
  const ended = parse("<DTC:a,C>{||:}C|I;{ENDING:1}</DTC>D|ii{/ENDING:1}{:||};{ENDING:2}E|III{/ENDING};", prefix.replace("adlib", "1/4"));
  assert.deepEqual(ended.playbackRoute.map((entry) => entry.dtcTag?.token ?? null), ["<DTC:a,C>", null, "<DTC:a,C>", "<DTC:a,C>"]);
});

test("MStructTime LOOP replays DTC and fullscreen keeps only the current pair", () => {
  const result = parse("<DTC:C,a>C|I,<DTC:E,C#>D|ii;</DTC>E|III,F|IV;", prefix.replace("adlib", "2/4"));
  const plan = buildMstructtimePlaybackPlan(result, {
    metadata: { musicLength: "0:10" }, loop: "1,2/4,1,1,1/4;",
    main: "{BN:1}{TS:2/4}{D:1/4}[0,1][2000,2],[1000,1][3000,2];{BN:2}[4000,1],[5000,1];",
  });
  assert.equal(plan.ready, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.entries.map((entry) => dtc(playbackEntryInformation(entry).activeTags)),
    [["<DTC:C,a>"], ["<DTC:E,C#>"], ["<DTC:C,a>"], ["<DTC:E,C#>"], [], []]);
});

test("DTC survives ellipses while search windows retain the existing discontinuity barrier", () => {
  const result = parse("<DTC:a,C>C|I;...{BN:5}D|ii,</DTC>E|III;");
  assert.equal(result.flow.find((node) => node.kind === "ellipsis").activeDtc.token, "<DTC:a,C>");
  assert.equal(matches(result, "<DTC:C,a>D|ii").length, 1);
  assert.equal(matches(result, "<DTC:a,C>C|I,<DTC:a,C>D|ii").length, 0);
});
