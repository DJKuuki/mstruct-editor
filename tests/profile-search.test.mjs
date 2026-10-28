import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMstructProfile } from "../src/core/profile.js";
import { INITIAL_PROFILE_ID, PROFILE_FILES } from "../src/core/profile-schema.js";
import { assignDocumentProfile, compileProfileDocument } from "../src/core/profile-document.js";
import { createEmptyMetadata, serializeMstructDocument } from "../src/core/mstruct-document.js";
import { parseMstructSearchQuery } from "../src/core/mstruct-search-query.js";
import { projectMstructSearchEvents } from "../src/core/mstruct-search-events.js";
import { matchMstructSearchQuery } from "../src/core/mstruct-search-match.js";
import { createProfileSearchVocabulary, deserializeSearchVocabulary, parseProfileSearchQuery, serializeSearchVocabulary } from "../src/core/profile-search.js";
import { createEditorConfig } from "../src/runtime/editor-config.js";
import { parseSpecialChordCsv } from "../src/core/chord-symbol.js";
import { parseRomanConfigCsv } from "../src/core/roman-symbol.js";
import { parseTagConfigCsv } from "../src/core/tag-config.js";
import { parseSemanticTagConfigCsv } from "../src/core/semantic-tags.js";

const files = Object.fromEntries(await Promise.all(PROFILE_FILES.map(async ({ name }) => [name, await readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8")])));
const create = (changes = {}, profileId = INITIAL_PROFILE_ID) => createMstructProfile({ profileId, files: { ...files, ...changes } });
const builtin = await create();
async function projection(profile, main) {
  const assigned = await assignDocumentProfile(serializeMstructDocument({ metadata: createEmptyMetadata(), main }), profile);
  assert.equal(assigned.ok, true, JSON.stringify(assigned.errors));
  return projectMstructSearchEvents(compileProfileDocument(assigned.document, profile));
}
function matches(source, family, projected) {
  const query = parseMstructSearchQuery(source, family.config);
  assert.equal(query.ok, true, JSON.stringify(query.errors));
  return matchMstructSearchQuery(query, projected).windows.length;
}

test("exact historical tag, special chord and Roman sources do not require the default dictionary", async () => {
  const old = await create({
    "special-chords.csv": `${files["special-chords.csv"]}old,old,Historical,1 3 5\n`,
    "tags.csv": `${files["tags.csv"]}<Historical_Tag>,历史,Historical,1\n`,
    "roman-special.csv": `${files["roman-special.csv"]}Hist,1,1 3 5,Hist,,,,,,,\n`,
  });
  const [family] = createProfileSearchVocabulary([{ profile: builtin, semanticFamily: "current" }]);
  const projected = await projection(old, "{BN:1}{TS:adlib}{D:1}{TC:C}</Historical_Tag>[C:C[sp:old]|R:Hist];");
  for (const source of ["<Historical_Tag>", "C[sp:old]|*", "*|Hist", "C[sp:old]|Hist", "(C[sp:old]||C[sp:Never])|(Hist||Never)"]) assert.equal(matches(source, family, projected), 1, source);
  assert.equal(parseMstructSearchQuery("C[sp:old]|Hist", family.config).events[0].harmony.chord.kind, "source");
  for (const [source, count] of [["*!(C[sp:old])|*", 0], ["*!(C[sp:Never])|*", 1], ["*|*!(Hist)", 0], ["*|*!(Never)", 1]]) {
    assert.equal(matches(source, family, projected), count, source);
  }
});

test("the same exact special source matches incompatible meanings while note sets remain profile-specific", async () => {
  const major = await create({ "special-chords.csv": `${files["special-chords.csv"]}test,test,Test,1 3 5\n` });
  const minor = await create({ "special-chords.csv": `${files["special-chords.csv"]}test,test,Test,1 b3 5\n` });
  const main = "{BN:1}{TS:adlib}{D:1}[C:C[sp:test]];";
  const [a, b] = await Promise.all([projection(major, main), projection(minor, main)]);
  const families = createProfileSearchVocabulary([{ profile: major, semanticFamily: "major" }, { profile: minor, semanticFamily: "minor" }]);
  assert.equal(families.length, 2);
  assert.throws(() => createProfileSearchVocabulary([{ profile: major, semanticFamily: "wrong" }, { profile: minor, semanticFamily: "wrong" }]), (error) => error.code === "profile-config-invalid");
  for (const family of families) {
    assert.equal(matches("C[sp:test]|* --notallowdifferentnotation", family, a), 1); assert.equal(matches("C[sp:test]|* --notallowdifferentnotation", family, b), 1);
    assert.equal(matches("C[sp:test]|*", family, a), family.semanticFamily === "major" ? 1 : 0);
    assert.equal(matches("C[sp:test]|*", family, b), family.semanticFamily === "minor" ? 1 : 0);
    assert.equal(matches("C[notes:0,4,7]|*", family, a), 1); assert.equal(matches("C[notes:0,4,7]|*", family, b), 0);
    assert.equal(matches("C[notes:0,3,7]|*", family, a), 0); assert.equal(matches("C[notes:0,3,7]|*", family, b), 1);
  }
});

test("compatible dictionary unions admit added generators and parameters without changing document compilation", async () => {
  const next = await create({
    "special-chords.csv": `${files["special-chords.csv"]}new,new,New,1 3 5\n`,
    "tonal-tags.csv": `${files["tonal-tags.csv"]}<Rare:>,稀有调式：{note},稀有音阶：{note},Rare Mode: {note},Rare Scale: {note}\n`,
    "sequence-tags.csv": `${files["sequence-tags.csv"]}Z9,Z9(+5/-4)\n`,
  }, "org.mstruct.official/rulesets/1.1.0");
  const [union] = createProfileSearchVocabulary([{ profile: builtin, semanticFamily: "compatible" }, { profile: next, semanticFamily: "compatible" }]);
  const [old] = createProfileSearchVocabulary([{ profile: builtin, semanticFamily: "other" }]);
  const fresh = await projection(next, "{BN:1}{TS:adlib}{D:1}<Mode_Rare:C><Seq:Z9(+5/-4)>[C:C[sp:new]]</Seq></Mode_Rare>;");
  for (const query of ["(0)[sp:new]|*", "<Mode_Rare:*>", "<Seq:Z9*>"]) {
    assert.equal(parseMstructSearchQuery(query, old.config).ok, false);
    assert.equal(matches(query, union, fresh), 1);
    const parsed = parseProfileSearchQuery(query, [old, union]);
    assert.equal(parsed.ok, true); assert.deepEqual(parsed.queries.map((item) => item.semanticFamily), ["compatible"]);
  }
  const clone = deserializeSearchVocabulary(JSON.parse(JSON.stringify(serializeSearchVocabulary([union]))));
  assert.equal(matches("<Seq:Z9*>", clone[0], fresh), 1);
  assert.equal((await projection(builtin, "{BN:1}{TS:adlib}{D:1}[C:C];")).events[0].chord.alternatives[0].source, "C");
});

test("Roman admission expansions merge in either order without changing historical compilation", async () => {
  const previous = await create({ "roman-advanced.csv": files["roman-advanced.csv"].replace('oM,b5,True,7,"7,65,43,42"', "oM,b5,True,7,7") });
  const recommended = await create({ "roman-basic.csv": files["roman-basic.csv"].replace("biii,b3,m,,M", 'biii,b3,m,,"M,o"') });
  const fresh = await projection(builtin, "{BN:1}{TS:adlib}{D:1}{TC:C}|ioM65;");
  for (const profiles of [[previous, builtin, recommended], [recommended, builtin, previous]]) {
    const [family] = createProfileSearchVocabulary(profiles.map(profile => ({ profile, semanticFamily: "compatible" })));
    assert.deepEqual(new Set(family.config.romanConfig.advanced.get("oM").allowedFiguredBass), new Set(["7", "65", "43", "42"]));
    assert.deepEqual(new Set(family.config.romanConfig.basics.get("biii").allowedAdvanced), new Set(["M", "o"]));
    const [transported] = deserializeSearchVocabulary(JSON.parse(JSON.stringify(serializeSearchVocabulary([family]))));
    assert.equal(matches("*|ioM65", transported, fresh), 1);
  }
  const historical = await assignDocumentProfile(serializeMstructDocument({ metadata: createEmptyMetadata(), main: "{BN:1}{TS:adlib}{D:1}{TC:C}|ioM65;" }), previous);
  assert.equal(historical.ok, false);
  const redefined = await create({ "roman-advanced.csv": files["roman-advanced.csv"].replace('oM,b5,True,7,"7,65,43,42"', 'oM,5,True,7,"7,65,43,42"') });
  assert.throws(() => createProfileSearchVocabulary([previous, redefined].map(profile => ({ profile, semanticFamily: "conflicting" }))), error => error.code === "profile-config-invalid");
});

test("unknown exact tokens yield zero, but malformed syntax and complexity still fail before matching", async () => {
  const [family] = createProfileSearchVocabulary([{ profile: builtin, semanticFamily: "current" }]);
  const projected = await projection(builtin, "{BN:1}{TS:adlib}{D:1}{TC:C}[C:C|R:I];");
  for (const source of ["C[sp:Never]|*", "*|Never", "<Never>", "<Mode_Absent:C>", "<Mode_Absent:(C||D)>", "<Seq:Z99>", "--globaltag:<Never>"]) assert.equal(matches(source, family, projected), 0, source);
  for (const source of ["C[sp:bad name]|*", "C[sp:Missing|*", "*|Never/XYZ", "*|V[3,5-x]", "*|V[99,3-x]", "</Never>", "<Mode_Absent:Invalid>", "<Centricity:C##>", "<Seq:Z99,Z99>", "<Seq:Z99(+5>", "*|V||", "*".repeat(4097)]) {
    assert.equal(parseProfileSearchQuery(source, [family]).ok, false, source);
  }
});

test("query vocabulary transport cannot replace an editor's bound compiler config", () => {
  const own = createProfileSearchVocabulary([{ profile: builtin, semanticFamily: "own" }])[0];
  const config = createEditorConfig({ specialChordCsv: files["special-chords.csv"], romanConfigCsv: { basicCsv: files["roman-basic.csv"], advancedCsv: files["roman-advanced.csv"], figuredBassCsv: files["roman-figured-bass.csv"], specialCsv: files["roman-special.csv"] }, tagCsv: files["tags.csv"], semanticTagConfigCsv: { cadenceCsv: files["cadence-tags.csv"], tonalCsv: files["tonal-tags.csv"], sequenceCsv: files["sequence-tags.csv"] }, parseSpecialChordCsv, parseRomanConfigCsv, parseTagConfigCsv, parseSemanticTagConfigCsv });
  const original = config.specialChords;
  config.applySearchVocabulary(serializeSearchVocabulary([own]), { mstructProfileId: builtin.manifest.profileId, mstructProfileHash: builtin.manifest.bundleHash });
  assert.notEqual(config.searchOptions.specialChords, original); assert.equal(config.specialChords, original);
  config.applyProfile(own.config); assert.equal(config.searchOptions.specialChords, own.config.specialChords);
});
