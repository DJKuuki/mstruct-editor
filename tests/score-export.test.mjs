import assert from "node:assert/strict";
import test from "node:test";
import {
  SCORE_EXPORT_BARLINE_WIDTH_PX,
  SCORE_EXPORT_HORIZONTAL_SAFE_INSET_PX,
  normalizeScoreExportSettings,
  paginateScoreSystems,
  resolveScoreExportCssUrl,
  scoreExportContinuousGeometry,
  scoreExportGeometry,
  scoreExportPageDistribution,
  scoreExportPageNames,
  scoreExportRasterGeometryAllowed,
} from "../src/core/score-export.js";

test("score export settings stay within the deliberately small first-version surface", () => {
  assert.deepEqual(normalizeScoreExportSettings({ format: "svg", paper: "a3", orientation: "landscape", margin: "wide", scale: 133, fillThreshold: 87, pngBackground: "transparent" }), {
    format: "svg",
    paper: "a3",
    orientation: "landscape",
    margin: "wide",
    scale: 135,
    pagination: "pages",
    fillThreshold: 85,
    pngBackground: "transparent",
  });
  assert.deepEqual(normalizeScoreExportSettings({ format: "gif", paper: "legal", orientation: "upside-down", margin: "custom", scale: 999 }), {
    format: "pdf",
    paper: "a4",
    orientation: "portrait",
    margin: "standard",
    scale: 150,
    pagination: "pages",
    fillThreshold: 85,
    pngBackground: "white",
  });
  assert.equal(normalizeScoreExportSettings({ pagination: "continuous" }).pagination, "continuous");
});

test("paper geometry reflows at logical width while retaining physical page dimensions", () => {
  const geometry = scoreExportGeometry({ paper: "a4", orientation: "landscape", margin: "standard", scale: 125 });
  assert.equal(geometry.widthMm, 297);
  assert.equal(geometry.heightMm, 210);
  assert.equal(geometry.marginMm, 15);
  assert.equal(geometry.scaleFactor, .9375);
  assert.ok(Math.abs(geometry.logicalWidthPx * .9375 - geometry.contentWidthPx) < .001);
  assert.equal(geometry.logicalHorizontalSafeInsetPx, SCORE_EXPORT_HORIZONTAL_SAFE_INSET_PX);
  assert.equal(geometry.logicalScoreWidthPx, geometry.logicalWidthPx - SCORE_EXPORT_HORIZONTAL_SAFE_INSET_PX * 2);
  assert.deepEqual([geometry.rasterWidthPx, geometry.rasterHeightPx], [3508, 2480]);
});

test("the new 100 percent uses the former 75 percent physical score size", () => {
  assert.equal(scoreExportGeometry({ scale: 100 }).scaleFactor, .75);
  assert.equal(scoreExportGeometry({ scale: 75 }).scaleFactor, .5625);
  assert.equal(SCORE_EXPORT_BARLINE_WIDTH_PX, 4 / 3);
});

test("continuous output keeps the selected width and extends only the page height", () => {
  const page = scoreExportGeometry({ paper: "a4", orientation: "portrait", margin: "standard", scale: 100 });
  const continuous = scoreExportContinuousGeometry(page, 1600);
  assert.equal(continuous.pageWidthPx, page.pageWidthPx);
  assert.equal(continuous.logicalWidthPx, page.logicalWidthPx);
  assert.equal(continuous.logicalHeightPx, 1600);
  assert.ok(Math.abs(continuous.pageHeightPx - (1600 * .75 + page.marginPx * 2)) < .001);
  assert.equal(continuous.rasterWidthPx, 2480);
  assert.equal(continuous.rasterHeightPx, Math.ceil(continuous.pageHeightPx / 96 * 300));
  assert.equal(scoreExportRasterGeometryAllowed(continuous), true);
  assert.equal(scoreExportRasterGeometryAllowed({ rasterWidthPx: 20_000, rasterHeightPx: 20_000 }), false);
  assert.equal(scoreExportRasterGeometryAllowed({ rasterWidthPx: 100, rasterHeightPx: 40_000 }), false);
});

test("CSS resources resolve relative to their stylesheet instead of index.html", () => {
  assert.equal(
    resolveScoreExportCssUrl("./font.woff2", "mstruct-app://renderer/assets/index.css", "mstruct-app://renderer/index.html"),
    "mstruct-app://renderer/assets/font.woff2",
  );
  assert.equal(
    resolveScoreExportCssUrl("./fonts/Academico.otf", "mstruct-app://renderer/chord-popover.css", "mstruct-app://renderer/index.html"),
    "mstruct-app://renderer/fonts/Academico.otf",
  );
});

test("pagination only breaks between complete systems and can reserve an intro-only page", () => {
  const systems = [
    { top: 0, bottom: 60 },
    { top: 70, bottom: 140 },
    { top: 150, bottom: 230 },
  ];
  assert.deepEqual(paginateScoreSystems({ introHeight: 30, systems, pageHeight: 160 }), {
    ok: true,
    pages: [
      { intro: true, startIndex: 0, endIndex: 0, chartStart: 0, chartHeight: 60 },
      { intro: false, startIndex: 1, endIndex: 2, chartStart: 70, chartHeight: 160 },
    ],
  });
  assert.deepEqual(paginateScoreSystems({ introHeight: 120, systems: [{ top: 0, bottom: 60 }], pageHeight: 160 }), {
    ok: true,
    pages: [
      { intro: true, startIndex: null, endIndex: null, chartStart: 0, chartHeight: 0 },
      { intro: false, startIndex: 0, endIndex: 0, chartStart: 0, chartHeight: 60 },
    ],
  });
  assert.deepEqual(paginateScoreSystems({ introHeight: 20, systems: [{ top: -12, bottom: 80 }], pageHeight: 120 }), {
    ok: true,
    pages: [{ intro: true, startIndex: 0, endIndex: 0, chartStart: -12, chartHeight: 92 }],
  });
});

test("pagination reports content that cannot fit without silently clipping or scaling", () => {
  assert.deepEqual(paginateScoreSystems({ introHeight: 170, systems: [], pageHeight: 160 }), {
    ok: false,
    reason: "intro-too-tall",
    systemIndex: null,
  });
  assert.deepEqual(paginateScoreSystems({ introHeight: 0, systems: [{ top: 0, bottom: 170 }], pageHeight: 160 }), {
    ok: false,
    reason: "system-too-tall",
    systemIndex: 0,
  });
});

test("paginated pages distribute only when their natural content reaches the fill threshold", () => {
  assert.deepEqual(scoreExportPageDistribution({
    intro: true,
    introHeight: 100,
    startIndex: 0,
    endIndex: 2,
    chartHeight: 330,
    pageHeight: 500,
  }), {
    systemGap: 35,
    sliceHeight: 400,
    chartStartOffset: 0,
  });
  assert.deepEqual(scoreExportPageDistribution({
    intro: false,
    startIndex: 2,
    endIndex: 4,
    chartHeight: 220,
    pageHeight: 400,
  }), {
    systemGap: 0,
    sliceHeight: 220,
    chartStartOffset: 0,
  });
  assert.deepEqual(scoreExportPageDistribution({
    intro: false,
    startIndex: 2,
    endIndex: 4,
    chartHeight: 220,
    pageHeight: 400,
    fillThreshold: 50,
  }), {
    systemGap: 90,
    sliceHeight: 400,
    chartStartOffset: 180,
  });
  assert.deepEqual(scoreExportPageDistribution({
    intro: false,
    startIndex: 3,
    endIndex: 3,
    chartHeight: 120,
    pageHeight: 400,
  }), {
    systemGap: 0,
    sliceHeight: 120,
    chartStartOffset: 0,
  });
});

test("multi-page still formats receive stable three-digit sibling names", () => {
  assert.deepEqual(scoreExportPageNames("K545.mstruct", "pdf", 8), ["K545.pdf"]);
  assert.deepEqual(scoreExportPageNames("K545.png", "png", 1), ["K545.png"]);
  assert.deepEqual(scoreExportPageNames("K545.png", "png", 3), ["K545-p001.png", "K545-p002.png", "K545-p003.png"]);
});
