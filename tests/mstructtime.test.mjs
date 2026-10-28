import assert from "node:assert/strict";
import test from "node:test";
import { parseMstruct } from "../src/core/mstruct.js";
import { createEmptyMetadata, parseMstructDocument, serializeMstructDocument } from "../src/core/mstruct-document.js";
import { STANDARD_LINK_FIELDS } from "../src/core/metadata-links.js";
import {
  createEmptyMstructtimeMetadata,
  createMstructtimeFileName,
  parseMstructtimeDocument,
  parseMstructtimeLoop,
  parseMstructtimeMain,
  serializeMstructtimeDocument,
} from "../src/core/mstructtime-document.js";
import {
  buildMstructtimeEventRows,
  buildMstructtimeRoute,
  serializeMstructtimeMain,
  updateMstructtimeRows,
} from "../src/core/mstructtime-route.js";

test("analysis and timeline links share all six defaults, ordered additional links and score links", () => {
  const links = Object.fromEntries(STANDARD_LINK_FIELDS.map(([key]) => [key, `https://example.com/${key}`]));
  const linkMetadata = { links, scoreUrls: ["https://example.com/score"], additionalUrls: [{ label: "Recording details", url: "https://example.com/details" }, { label: "Other", url: "https://example.com/other" }] };
  const metadata = { ...createEmptyMstructtimeMetadata(), name: "Recording", performers: [{ name: "Performer" }], musicLength: "4:30", ...linkMetadata };
  const timelineText = serializeMstructtimeDocument({ metadata, loop: "1,1/4,1,end;", main: "{BN:1}{TS:4/4}{D:1/4}[300,1];" });
  assert.match(timelineText, /\{URL_APPLE_MUSIC\}https:\/\/example.com\/appleMusic/);
  const timeline = parseMstructtimeDocument(timelineText);
  assert.equal(timeline.ok, true);
  const analysis = parseMstructDocument(serializeMstructDocument({ metadata: { ...createEmptyMetadata(), ...linkMetadata }, main: "X;" }));
  for (const field of ["links", "scoreUrls", "additionalUrls"]) {
    assert.deepEqual(timeline.metadata[field], analysis.metadata[field]);
    assert.deepEqual(timeline.metadata[field], linkMetadata[field]);
  }
  assert.equal(serializeMstructtimeDocument(timeline), timelineText);
  for (const tag of ["SCORE_URL_10", "URL_ADDITIONAL_10:Too many"]) {
    const invalid = parseMstructtimeDocument(timelineText.replace("END_METADATA", `{${tag}}https://example.com\nEND_METADATA`));
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some(error => error.code.endsWith("url-limit")));
  }
  const legacy = parseMstructtimeDocument(timelineText.replace(/\{URL_ADDITIONAL_\d+:/g, "{URL_ADDITIONAL:"));
  assert.deepEqual(legacy.metadata.additionalUrls, linkMetadata.additionalUrls);
  const old = parseMstructtimeDocument(timelineText.replace(/^\{(?:URL_|SCORE_URL_).*\n/gm, ""));
  assert.equal(old.ok, true);
  assert.equal(old.metadata.links.appleMusic, "");
});

test("mstructtime 三段文档及录音元数据可规范往返", () => {
  const metadata = createEmptyMstructtimeMetadata();
  metadata.name = "内田光子 1985";
  metadata.nameRomanized = "Mitsuko Uchida 1985";
  metadata.performers = [
    { name: "内田光子", romanized: "Mitsuko Uchida" },
    { name: "English Performer", romanized: "" },
  ];
  metadata.recordAlbum = "モーツァルト：ピアノ・ソナタ集";
  metadata.recordAlbumRomanized = "Mozart Piano Sonatas";
  metadata.recordYear = "1985";
  metadata.musicLength = "14:22";
  const text = serializeMstructtimeDocument({
    metadata,
    loop: "2,4/4,1,1,1/4;",
    main: "{BN:1}{TS:4/4}{D:1/4}[1000,1],...[2000,1]",
  });
  const parsed = parseMstructtimeDocument(text);
  assert.equal(parsed.ok, true, parsed.errors.map((item) => item.code).join(","));
  assert.equal(parsed.metadata.performers.length, 2);
  assert.equal(parsed.metadata.musicLength, "14:22");
  assert.equal(parsed.entries[0].milliseconds, 1000);
  assert.equal(parsed.entries[1].kind, "ellipsis");
});

test("mstructtime 必填、罗马化、年代和时长会被校验", () => {
  const text = serializeMstructtimeDocument({ metadata: createEmptyMstructtimeMetadata(), loop: "", main: "" });
  const parsed = parseMstructtimeDocument(text);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((item) => item.code === "mstructtime-name-required"));
  assert.ok(parsed.errors.some((item) => item.code === "mstructtime-performer-required"));
  assert.ok(parsed.errors.some((item) => item.code === "mstructtime-length-required"));
});

test("显式 LOOP 按来源位置经过次数生成实际事件顺序", () => {
  const analysis = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;E|,F|;");
  assert.equal(analysis.ok, true);
  const loop = "1,2/4,1,1,1/4;\n1,2/4,2,2,1/4;";
  const route = buildMstructtimeRoute(analysis, loop);
  assert.equal(route.ok, true, route.errors.map((item) => item.code).join(","));
  assert.deepEqual(route.route.filter((item) => item.slot?.events.length).map((item) => [item.measure, item.beat, item.pass]), [
    [1, "1/4", 1], [1, "2/4", 1],
    [1, "1/4", 2], [1, "2/4", 2],
    [2, "1/4", 1], [2, "2/4", 1],
  ]);
});

test("LOOP end 在指定遍数的拍位结束路线并截断后续事件", () => {
  const parsed = parseMstructtimeLoop("1,2/4,2,end;");
  assert.equal(parsed.ok, true, parsed.errors.map((item) => item.code).join(","));
  assert.equal(parsed.instructions[0].type, "end");

  const analysis = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;E|,F|;");
  assert.equal(analysis.ok, true, analysis.errors.map((item) => item.code).join(","));
  const loop = "1,2/4,1,1,1/4;\n1,2/4,2,end;";
  const route = buildMstructtimeRoute(analysis, loop);
  assert.equal(route.ok, true, route.errors.map((item) => item.code).join(","));
  assert.deepEqual(route.route.filter((item) => item.slot?.events.length).map((item) => [item.measure, item.beat, item.pass]), [
    [1, "1/4", 1], [1, "2/4", 1],
    [1, "1/4", 2], [1, "2/4", 2],
  ]);

  const generated = buildMstructtimeEventRows(analysis, loop, "");
  assert.deepEqual(generated.rows.slice(1).map((row) => [row.measure, row.beat, row.pass]), [
    [1, "1/4", 1], [1, "2/4", 1],
    [1, "1/4", 2], [1, "2/4", 2],
  ]);
});

test("逗号后的省略号是带小节、开始拍位和遍数的正式事件", () => {
  const analysis = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,...{BN:4}{TS:4/4}{D:1/4}D|,E|,F|,G|;");
  assert.equal(analysis.ok, true, analysis.errors.map((item) => item.code).join(","));
  const generated = buildMstructtimeEventRows(analysis, "", "");
  assert.equal(generated.ok, true);
  const ellipsis = generated.rows.find((row) => row.kind === "ellipsis");
  assert.deepEqual([ellipsis.measure, ellipsis.beat, ellipsis.pass], [1, "2/4", 1]);
});

test("空时间戳合法，事件 MAIN 可从路线生成并保留同位置残余遍数", () => {
  const analysis = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;");
  const initial = buildMstructtimeEventRows(analysis, "", "{BN:1}{TS:2/4}{D:1/4}[100,1][900,3],[,1];");
  assert.equal(initial.ok, true);
  const rows = updateMstructtimeRows(initial.rows, 2, 800);
  const main = serializeMstructtimeMain(analysis, rows, initial.entries);
  const parsed = parseMstructtimeMain(main);
  assert.equal(parsed.ok, true, parsed.errors.map((item) => item.code).join(","));
  assert.ok(parsed.entries.some((item) => item.pass === 3 && item.milliseconds === 900));
  assert.ok(parsed.entries.some((item) => item.pass === 1 && item.milliseconds === 800));
});

test("时间轴自动文件名使用父文件名和不可复用随机标识", () => {
  assert.equal(createMstructtimeFileName("k545.mstruct", "a4f9-1c2d-extra"), "k545-time-a4f91c2d.mstructtime");
});
