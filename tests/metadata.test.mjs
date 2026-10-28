import assert from "node:assert/strict";
import test from "node:test";
import {
  createMstructFileName,
  createEmptyMetadata,
  isAsciiRomanized,
  isSongLength,
  MAX_ADDITIONAL_URLS,
  MAX_COMPOSERS,
  MAX_MSTRUCTTIME_FILES,
  MAX_SCORE_URLS,
  MAX_TAGS,
  parseMstructDocument,
  serializeMstructDocument,
} from "../src/core/mstruct-document.js";

test("元数据与 MAIN 主体脚本可独立序列化并往返读取", () => {
  const metadata = createEmptyMetadata();
  metadata.creator = "ExampleAuthor";
  metadata.editors = ["ExampleAuthor", "Mira", "ExampleAuthor"];
  metadata.versionName = "ExampleAuthor v1";
  metadata.songName = "あちこちデートさん";
  metadata.songNameRomanized = "Achikochi Date-san";
  metadata.composers = [{ name: "緒方駄菓子", romanized: "Ogata Dagashi", alias: "駄菓子P", id: "42" }];
  metadata.tags = ["初音ミク", "重音テト"];
  metadata.globalTags = "</Binary_Form></Mode_Dorian:C>";
  metadata.songLength = "1:04:30";
  metadata.isStableTempo = true;
  metadata.offset = "-35";
  metadata.links.youtube = "https://www.youtube.com/watch?v=example";
  metadata.additionalUrls = [{ label: "SoundCloud", url: "https://soundcloud.com/example" }];
  metadata.comments = "第一行备注\n第二行备注";
  const main = "{BN:1}{TS:adlib}{D:1/4}{TC:C}[C:C|R:I],[C:F|R:IV],[C:G|R:V],[C:C|R:I];";

  const comments = [{ number: 1, texts: { zh_cn: "第一行注释\n第二行注释", en: "First comment" } }];
  const serialized = serializeMstructDocument({ metadata, main, comments });
  assert.match(serialized, /^METADATA:\n/m);
  assert.match(serialized, /\nEND_METADATA\n\nMAIN:\n/);
  assert.match(serialized, /\nEND_MAIN\n\nCOMMENT:\n/);
  assert.match(serialized, /\nEND_COMMENT$/);

  const parsed = parseMstructDocument(serialized);
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.main, main);
  assert.equal(parsed.metadata.creator, "ExampleAuthor");
  assert.deepEqual(parsed.metadata.editors, ["ExampleAuthor", "Mira"]);
  assert.equal(parsed.metadata.versionName, "ExampleAuthor v1");
  assert.match(serialized, /\{VERSION_NAME\}ExampleAuthor v1/);
  assert.equal(parsed.metadata.composers[0].romanized, "Ogata Dagashi");
  assert.equal(parsed.metadata.composers[0].alias, "駄菓子P");
  assert.equal(parsed.metadata.composers[0].id, "42");
  assert.deepEqual(parsed.metadata.tags, ["初音ミク", "重音テト"]);
  assert.equal(parsed.metadata.globalTags, "</Binary_Form></Mode_Dorian:C>");
  assert.equal(parsed.metadata.isStableTempo, true);
  assert.equal(parsed.metadata.offset, "-35");
  assert.deepEqual(parsed.comments, comments);
  assert.match(serialized, /\{IS_STABLE_TEMPO\}True/);
  assert.match(serialized, /\{TAG\}初音ミク,重音テト/);
  assert.match(serialized, /\{GLOBAL_TAGS\}<\/Binary_Form><\/Mode_Dorian:C>/);
  assert.equal(parsed.metadata.additionalUrls[0].label, "SoundCloud");
  assert.equal(parsed.metadata.comments, "第一行备注\n第二行备注");
  assert.equal(serializeMstructDocument({ metadata: parsed.metadata, main: parsed.main, comments: parsed.comments }), serialized);
});

test("旧文档无需 COMMENT 区域，OFFSET 只在稳定速度启用时校验", () => {
  const legacyEnvelope = [
    "METADATA:",
    "{IS_STABLE_TEMPO}False",
    "{OFFSET}尚未启用",
    "END_METADATA",
    "",
    "MAIN:",
    "{BN:1}{TS:adlib}{D:1}C|;",
    "END_MAIN",
  ].join("\n");
  const unchecked = parseMstructDocument(legacyEnvelope);
  assert.equal(unchecked.ok, true);
  assert.equal(unchecked.metadata.offset, "尚未启用");
  assert.deepEqual(unchecked.comments, []);

  const checked = parseMstructDocument(legacyEnvelope.replace("False", "True"));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((error) => error.code === "offset-integer"));
});

test("COMMENT 区域要求 END_COMMENT，并拒绝重复或嵌套的正文定义", () => {
  const metadata = createEmptyMetadata();
  const valid = serializeMstructDocument({
    metadata,
    main: "{BN:1}{TS:adlib}{D:1}[/COMMENT:1]C|;",
    comments: [{ number: 1, texts: { zh_cn: "正文", en: "Body" } }],
  });
  assert.equal(parseMstructDocument(valid).ok, true);
  assert.equal(parseMstructDocument(valid.replace(/\nEND_COMMENT$/, "")).ok, false);

  const duplicate = valid.replace(
    "[COMMENT:1<en>]\nBody\n[/COMMENT:1<en>]",
    "[COMMENT:1<en>]\nBody\n[/COMMENT:1<en>]\n\n[COMMENT:1<en>]\n[/COMMENT:1<en>]",
  );
  const duplicateResult = parseMstructDocument(duplicate);
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.errors.some((error) => error.code === "comment-definition-duplicate"));

  const embedded = valid.replace("正文", "正文 [COMMENT:2<zh_cn>]");
  const embeddedResult = parseMstructDocument(embedded);
  assert.equal(embeddedResult.ok, false);
  assert.ok(embeddedResult.errors.some((error) => error.code === "comment-body-syntax"));
});

test("旧演出与录音字段导入时忽略并在保存后删除", () => {
  const source = [
    "METADATA:",
    "{PERFORMER}演奏者",
    "{PERFORMER_ROMANIZED}Performer",
    "{RECORD_ALBUM}录音专辑",
    "{RECORD_ALBUM_ROMANIZED}Record Album",
    "END_METADATA",
    "",
    "MAIN:",
    "{BN:1}{TS:adlib}{D:1}[C:C];",
    "END_MAIN",
  ].join("\n");
  const once = parseMstructDocument(source);
  assert.equal(once.ok, true);
  assert.deepEqual(once.metadata.extraFields, []);
  const firstSave = serializeMstructDocument({ metadata: once.metadata, main: once.main });
  const twice = parseMstructDocument(firstSave);
  assert.equal(twice.ok, true);
  assert.deepEqual(twice.metadata.extraFields, []);
  const secondSave = serializeMstructDocument({ metadata: twice.metadata, main: twice.main });
  assert.equal(secondSave, firstSave);
  assert.doesNotMatch(secondSave, /\{PERFORMER(?:_ROMANIZED)?\}|\{RECORD_ALBUM(?:_ROMANIZED)?\}/);
});

test("mstructtime 文件名关联最多一百个、按顺序往返且稳定速度禁止关联", () => {
  const metadata = createEmptyMetadata();
  metadata.mstructtimeFiles = ["first.mstructtime", "second.mstructtime"];
  const serialized = serializeMstructDocument({ metadata, main: "{BN:1}{TS:adlib}{D:1}C|;" });
  assert.match(serialized, /\{MSTRUCTTIME_1\}first\.mstructtime/);
  assert.match(serialized, /\{MSTRUCTTIME_2\}second\.mstructtime/);
  assert.deepEqual(parseMstructDocument(serialized).metadata.mstructtimeFiles, ["first.mstructtime", "second.mstructtime"]);

  const overflow = `METADATA:\n{IS_STABLE_TEMPO}False\n{MSTRUCTTIME_${MAX_MSTRUCTTIME_FILES + 1}}too-many.mstructtime\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}C|;\nEND_MAIN`;
  assert.ok(parseMstructDocument(overflow).errors.some((item) => item.code === "mstructtime-limit"));
  const stable = parseMstructDocument(serialized.replace("{IS_STABLE_TEMPO}False", "{IS_STABLE_TEMPO}True"));
  assert.ok(stable.errors.some((item) => item.code === "stable-tempo-mstructtime"));
});

test("主体脚本旧文本仍可作为无元数据的兼容输入读取", () => {
  const main = "{BN:1}{TS:adlib}{D:1}[C:C];";
  const parsed = parseMstructDocument(main);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.legacy, true);
  assert.equal(parsed.main, main);
  assert.equal(parsed.metadata.songName, "");
});

test("出现文档标记但缺少闭合区块时不误当成 MAIN", () => {
  const parsed = parseMstructDocument("METADATA:\n{ANALYZER}ExampleAuthor\nMAIN:\n{BN:1}{TS:adlib}{D:1};");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.errors[0].code, "document-envelope");
});

test("旧 ANALYZER 署名兼容读入，并在下一次保存时升级为 CREATOR", () => {
  const legacy = [
    "METADATA:",
    "{ANALYZER}ExampleAuthor",
    "{EDITORS}ExampleAuthor,Mira,ExampleAuthor",
    "END_METADATA",
    "",
    "MAIN:",
    "{BN:1}{TS:adlib}{D:1}[C:C];",
    "END_MAIN",
  ].join("\n");
  const parsed = parseMstructDocument(legacy);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.metadata.creator, "ExampleAuthor");
  assert.deepEqual(parsed.metadata.editors, ["ExampleAuthor", "Mira"]);
  const upgraded = serializeMstructDocument({ metadata: parsed.metadata, main: parsed.main });
  assert.match(upgraded, /\{CREATOR\}ExampleAuthor/);
  assert.match(upgraded, /\{EDITORS\}ExampleAuthor,Mira/);
  assert.doesNotMatch(upgraded, /\{ANALYZER\}/);
});

test("原唱歌手与转载署名使用受控的标准元数据字段", () => {
  const metadata = createEmptyMetadata();
  metadata.reposted = true;
  metadata.originalAnalyzer = "June Lee";
  metadata.originalAnalyzerRomanized = "June Lee";
  metadata.originalEditor = "ExampleAuthor";
  metadata.coEditors = ["Mira", "ExampleAuthor", "Mira"];
  metadata.originalVocalists = [{ name: "初音ミク", romanized: "Hatsune Miku" }, { name: "巡音ルカ", romanized: "Megurine Luka" }];
  metadata.creator = "Must not be serialized";
  metadata.editors = ["Must not be serialized"];

  const serialized = serializeMstructDocument({ metadata, main: "{BN:1}{TS:adlib}{D:1}[C:C];" });
  assert.match(serialized, /\{REPOSTED\}TRUE/);
  assert.match(serialized, /\{ORIGINAL_ANALYZER\}June Lee/);
  assert.match(serialized, /\{ORIGINAL_ANALYZER_ROMANIZED\}June Lee/);
  assert.match(serialized, /\{ORIGINAL_EDITOR\}ExampleAuthor/);
  assert.match(serialized, /\{CO_EDITOR\}Mira,ExampleAuthor/);
  assert.match(serialized, /\{ORIGINAL_VOCALIST_1\}初音ミク/);
  assert.match(serialized, /\{ORIGINAL_VOCALIST_1_ROMANIZED\}Hatsune Miku/);
  assert.match(serialized, /\{ORIGINAL_VOCALIST_2\}巡音ルカ/);
  assert.doesNotMatch(serialized, /\{CREATOR\}/);
  assert.doesNotMatch(serialized, /\{EDITORS\}/);

  const parsed = parseMstructDocument(serialized);
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  assert.equal(parsed.metadata.reposted, true);
  assert.deepEqual(parsed.metadata.coEditors, ["Mira", "ExampleAuthor"]);
  assert.equal(parsed.metadata.originalVocalistRomanized, "Hatsune Miku");
  assert.equal(parsed.metadata.originalVocalists.length, 2);
  assert.equal(serializeMstructDocument({ metadata: parsed.metadata, main: parsed.main }), serialized);
});

test("原唱歌手最多二十位，旧单项字段仍可读入", () => {
  const metadata = createEmptyMetadata();
  metadata.originalVocalists = Array.from({ length: 21 }, (_, index) => ({ name: `Vocalist ${index + 1}`, romanized: "" }));
  const serialized = serializeMstructDocument({ metadata, main: "" });
  assert.match(serialized, /\{ORIGINAL_VOCALIST_20\}Vocalist 20/);
  assert.doesNotMatch(serialized, /\{ORIGINAL_VOCALIST_21\}/);
  const legacy = parseMstructDocument("METADATA:\n{ORIGINAL_VOCALIST}初音ミク\n{ORIGINAL_VOCALIST_ROMANIZED}Hatsune Miku\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}[C:C];\nEND_MAIN");
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.metadata.originalVocalists, [{ name: "初音ミク", romanized: "Hatsune Miku" }]);
});

test("REPOSTED 只接受大写 TRUE 或 FALSE", () => {
  const parsed = parseMstructDocument("METADATA:\n{REPOSTED}true\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}[C:C];\nEND_MAIN");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors[0].code, "reposted-boolean");
});

test("IS_STABLE_TEMPO 只接受区分大小写的 True 或 False", () => {
  for (const [value, expected] of [["True", true], ["False", false]]) {
    const parsed = parseMstructDocument(`METADATA:\n{IS_STABLE_TEMPO}${value}\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}C|;\nEND_MAIN`);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.metadata.isStableTempo, expected);
  }
  for (const value of ["TRUE", "FALSE", "true", "false"]) {
    const parsed = parseMstructDocument(`METADATA:\n{IS_STABLE_TEMPO}${value}\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}C|;\nEND_MAIN`);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.errors[0].code, "stable-tempo-boolean");
  }
});

test("歌曲长度只接受规定的四类格式", () => {
  for (const value of ["4:30", "12:34", "1:04:30", "12:34:56", ""]) assert.equal(isSongLength(value), true);
  for (const value of ["4:3", "123:45", "4:61", "1:4:30", "1:60:30"]) assert.equal(isSongLength(value), false);
});

test("同一行连续的元数据标签会分别还原，兼容旧式附加链接标签", () => {
  const source = [
    "METADATA:",
    "{SONG_NAME}原曲名{SONG_NAME_ROMANIZED}Song Name",
    "{COMPOSER_NAME_1}作曲者{COMPOSER_NAME_1_ROMANIZED}Composer One",
    "{ALBUM_NAME}专辑{ALBUM_NAME_ROMANIZED}Album Name",
    "{URL_ADDITIONAL:SoundCloud}https://soundcloud.com/example",
    "{COMMENTS}",
    "Imported metadata.",
    "{COMMENTS_END}",
    "END_METADATA",
    "",
    "MAIN:",
    "{BN:1}{TS:adlib}{D:1}[C:C];",
    "END_MAIN",
  ].join("\n");

  const parsed = parseMstructDocument(source);
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  assert.equal(parsed.metadata.songNameRomanized, "Song Name");
  assert.equal(parsed.metadata.composers[0].romanized, "Composer One");
  assert.equal(parsed.metadata.albumNameRomanized, "Album Name");
  assert.deepEqual(parsed.metadata.additionalUrls[0], {
    label: "SoundCloud",
    url: "https://soundcloud.com/example",
  });
  assert.equal(parsed.main, "{BN:1}{TS:adlib}{D:1}[C:C];");
});

test("作曲者、乐谱链接和附加链接均最多保留九条", () => {
  const metadata = createEmptyMetadata();
  metadata.composers = Array.from({ length: MAX_COMPOSERS + 1 }, (_, index) => ({
    name: `Composer ${index + 1}`,
    romanized: `Composer ${index + 1}`,
  }));
  metadata.scoreUrls = Array.from({ length: MAX_SCORE_URLS + 1 }, (_, index) => `https://example.test/score-${index + 1}`);
  metadata.additionalUrls = Array.from({ length: MAX_ADDITIONAL_URLS + 1 }, (_, index) => ({
    label: `Site ${index + 1}`,
    url: `https://example.test/site-${index + 1}`,
  }));

  const serialized = serializeMstructDocument({ metadata, main: "{BN:1}{TS:adlib}{D:1}[C:C];" });
  assert.match(serialized, /\{COMPOSER_NAME_9\}/);
  assert.match(serialized, /\{SCORE_URL_9\}/);
  assert.match(serialized, /\{URL_ADDITIONAL_9:Site 9\}/);
  assert.doesNotMatch(serialized, /COMPOSER_NAME_10|SCORE_URL_10|URL_ADDITIONAL_10/);

  const overLimit = parseMstructDocument("METADATA:\n{COMPOSER_NAME_10}Too many\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}[C:C];\nEND_MAIN");
  assert.equal(overLimit.ok, false);
  assert.equal(overLimit.errors[0].code, "composer-limit");
  assert.equal(overLimit.errors[0].details.count, 9);
});

test("TAG 最多保留二十项并拒绝超限导入", () => {
  const metadata = createEmptyMetadata();
  metadata.tags = Array.from({ length: MAX_TAGS + 1 }, (_, index) => `Tag ${index + 1}`);
  const serialized = serializeMstructDocument({ metadata, main: "{BN:1}{TS:adlib}{D:1}[C:C];" });
  assert.match(serialized, /Tag 20/);
  assert.doesNotMatch(serialized, /Tag 21/);
  const source = `METADATA:\n{TAG}${Array.from({ length: MAX_TAGS + 1 }, (_, index) => `Tag ${index + 1}`).join(",")}\nEND_METADATA\n\nMAIN:\n{BN:1}{TS:adlib}{D:1}[C:C];\nEND_MAIN`;
  const parsed = parseMstructDocument(source);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors[0].code, "tag-limit");
  assert.equal(parsed.errors[0].details.count, 20);
});

test("导入保留不合规曲目信息；ASCII 检查留给编辑对话框保存时执行", () => {
  assert.equal(isAsciiRomanized("Achikochi Date-san (feat. Merrow)"), true);
  assert.equal(isAsciiRomanized("楽曲名"), false);

  const parsed = parseMstructDocument("METADATA:\n{SONG_NAME_ROMANIZED}楽曲名\n{SONG_LENGTH}4:3\n{URL_ADDITIONAL_1:Only label}\nEND_METADATA\nMAIN:\n{BN:1}{TS:adlib}{D:1}[C:C];\nEND_MAIN");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  assert.equal(parsed.metadata.songNameRomanized, "楽曲名");
  assert.equal(parsed.metadata.songLength, "4:3");
  assert.deepEqual(parsed.metadata.additionalUrls[0], { label: "Only label", url: "" });

  const exported = serializeMstructDocument({ metadata: parsed.metadata, main: parsed.main });
  assert.match(exported, /\{SONG_NAME_ROMANIZED\}楽曲名/);
  assert.match(exported, /\{SONG_LENGTH\}4:3/);
  assert.match(exported, /\{URL_ADDITIONAL_1:Only label\}/);
});

test("导出文件名按曲名优先级使用本机时间戳", () => {
  const localTime = new Date(2026, 7, 10, 23, 20, 58);
  assert.equal(
    createMstructFileName({ songNameRomanized: "Song Name", songName: "原曲名" }, localTime),
    "Song Name-20260810-232058.mstruct",
  );
  assert.equal(createMstructFileName({ songName: "原曲名" }, localTime), "原曲名-20260810-232058.mstruct");
  assert.equal(createMstructFileName({}, localTime), "untitled-20260810-232058.mstruct");
});
