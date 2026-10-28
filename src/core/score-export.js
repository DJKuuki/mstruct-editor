export const SCORE_EXPORT_STORAGE_KEY = "mstruct-score-export-settings-v1";
export const SCORE_EXPORT_DPI = 300;
export const SCORE_EXPORT_BASE_SCALE = .75;
export const SCORE_EXPORT_BARLINE_WIDTH_PX = 4 / 3;
export const SCORE_EXPORT_HORIZONTAL_SAFE_INSET_PX = 16;
export const SCORE_EXPORT_DEFAULT_FILL_THRESHOLD = 85;
export const SCORE_EXPORT_MAX_RASTER_DIMENSION = 32767;
export const SCORE_EXPORT_MAX_RASTER_PIXELS = 32_000_000;
export const SCORE_EXPORT_FORMATS = Object.freeze(["pdf", "svg", "png", "jpg"]);

export const SCORE_EXPORT_PAPERS = Object.freeze({
  a4: Object.freeze({ widthMm: 210, heightMm: 297 }),
  a3: Object.freeze({ widthMm: 297, heightMm: 420 }),
  letter: Object.freeze({ widthMm: 215.9, heightMm: 279.4 }),
});

export const SCORE_EXPORT_MARGINS = Object.freeze({
  narrow: 10,
  standard: 15,
  wide: 20,
});

export const DEFAULT_SCORE_EXPORT_SETTINGS = Object.freeze({
  format: "pdf",
  paper: "a4",
  orientation: "portrait",
  margin: "standard",
  scale: 100,
  pagination: "pages",
  fillThreshold: SCORE_EXPORT_DEFAULT_FILL_THRESHOLD,
  pngBackground: "white",
});

export function normalizeScoreExportSettings(value = {}) {
  const scale = Math.round(Number(value.scale) / 5) * 5;
  const fillThreshold = Math.round(Number(value.fillThreshold) / 5) * 5;
  return {
    format: SCORE_EXPORT_FORMATS.includes(value.format) ? value.format : DEFAULT_SCORE_EXPORT_SETTINGS.format,
    paper: Object.hasOwn(SCORE_EXPORT_PAPERS, value.paper) ? value.paper : DEFAULT_SCORE_EXPORT_SETTINGS.paper,
    orientation: value.orientation === "landscape" ? "landscape" : "portrait",
    margin: Object.hasOwn(SCORE_EXPORT_MARGINS, value.margin) ? value.margin : DEFAULT_SCORE_EXPORT_SETTINGS.margin,
    scale: Number.isFinite(scale) ? Math.min(150, Math.max(75, scale)) : DEFAULT_SCORE_EXPORT_SETTINGS.scale,
    pagination: value.pagination === "continuous" ? "continuous" : "pages",
    fillThreshold: Number.isFinite(fillThreshold)
      ? Math.min(100, Math.max(50, fillThreshold))
      : DEFAULT_SCORE_EXPORT_SETTINGS.fillThreshold,
    pngBackground: value.pngBackground === "transparent" ? "transparent" : "white",
  };
}

export function scoreExportContinuousGeometry(baseGeometry, logicalContentHeight) {
  const logicalHeightPx = Math.max(1, Number(logicalContentHeight) || 0);
  const contentHeightPx = logicalHeightPx * baseGeometry.scaleFactor;
  const pageHeightPx = contentHeightPx + baseGeometry.marginPx * 2;
  return {
    ...baseGeometry,
    heightMm: pageHeightPx * 25.4 / 96,
    pageHeightPx,
    contentHeightPx,
    logicalHeightPx,
    rasterHeightPx: Math.ceil(pageHeightPx / 96 * SCORE_EXPORT_DPI),
  };
}

export function scoreExportRasterGeometryAllowed(geometry) {
  const width = Math.floor(Number(geometry?.rasterWidthPx));
  const height = Math.floor(Number(geometry?.rasterHeightPx));
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width <= SCORE_EXPORT_MAX_RASTER_DIMENSION
    && height <= SCORE_EXPORT_MAX_RASTER_DIMENSION
    && width * height <= SCORE_EXPORT_MAX_RASTER_PIXELS;
}

export function millimetersToCssPixels(value) {
  return Number(value) * 96 / 25.4;
}

export function scoreExportGeometry(value = {}) {
  const settings = normalizeScoreExportSettings(value);
  const paper = SCORE_EXPORT_PAPERS[settings.paper];
  const landscape = settings.orientation === "landscape";
  const widthMm = landscape ? paper.heightMm : paper.widthMm;
  const heightMm = landscape ? paper.widthMm : paper.heightMm;
  const marginMm = SCORE_EXPORT_MARGINS[settings.margin];
  const scaleFactor = settings.scale / 100 * SCORE_EXPORT_BASE_SCALE;
  const pageWidthPx = millimetersToCssPixels(widthMm);
  const pageHeightPx = millimetersToCssPixels(heightMm);
  const marginPx = millimetersToCssPixels(marginMm);
  const contentWidthPx = pageWidthPx - marginPx * 2;
  const contentHeightPx = pageHeightPx - marginPx * 2;
  const logicalWidthPx = contentWidthPx / scaleFactor;
  return {
    ...settings,
    widthMm,
    heightMm,
    marginMm,
    scaleFactor,
    pageWidthPx,
    pageHeightPx,
    marginPx,
    contentWidthPx,
    contentHeightPx,
    logicalWidthPx,
    logicalHeightPx: contentHeightPx / scaleFactor,
    logicalHorizontalSafeInsetPx: SCORE_EXPORT_HORIZONTAL_SAFE_INSET_PX,
    logicalScoreWidthPx: Math.max(1, logicalWidthPx - SCORE_EXPORT_HORIZONTAL_SAFE_INSET_PX * 2),
    rasterWidthPx: Math.round(widthMm / 25.4 * SCORE_EXPORT_DPI),
    rasterHeightPx: Math.round(heightMm / 25.4 * SCORE_EXPORT_DPI),
  };
}

export function resolveScoreExportCssUrl(source, styleSheetUrl, documentUrl) {
  return new URL(String(source), styleSheetUrl || documentUrl).href;
}

function pageWithSystems(intro, systems, startIndex, endIndex) {
  const first = systems[startIndex];
  const last = systems[endIndex];
  return {
    intro,
    startIndex,
    endIndex,
    chartStart: first.top,
    chartHeight: last.bottom - first.top,
  };
}

export function paginateScoreSystems({ introHeight = 0, systems = [], pageHeight }) {
  const safePageHeight = Number(pageHeight);
  const safeIntroHeight = Math.max(0, Number(introHeight) || 0);
  if (!Number.isFinite(safePageHeight) || safePageHeight <= 0) throw new RangeError("Export page height must be positive.");
  if (safeIntroHeight > safePageHeight + .5) return { ok: false, reason: "intro-too-tall", systemIndex: null };

  const normalizedSystems = systems.map((system, index) => {
    const top = Number(system.top);
    const bottom = Number(system.bottom);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < top) {
      throw new RangeError(`Invalid export system bounds at index ${index}.`);
    }
    return { top, bottom };
  });

  if (!normalizedSystems.length) return { ok: true, pages: [{ intro: true, startIndex: null, endIndex: null, chartStart: 0, chartHeight: 0 }] };

  const pages = [];
  let index = 0;
  let firstPage = true;
  while (index < normalizedSystems.length) {
    const intro = firstPage;
    const availableHeight = safePageHeight - (intro ? safeIntroHeight : 0);
    const firstSystem = normalizedSystems[index];
    const firstHeight = firstSystem.bottom - firstSystem.top;

    if (firstHeight > availableHeight + .5) {
      if (intro && safeIntroHeight > 0) {
        pages.push({ intro: true, startIndex: null, endIndex: null, chartStart: 0, chartHeight: 0 });
        firstPage = false;
        continue;
      }
      return { ok: false, reason: "system-too-tall", systemIndex: index };
    }

    let endIndex = index;
    while (endIndex + 1 < normalizedSystems.length) {
      const nextHeight = normalizedSystems[endIndex + 1].bottom - firstSystem.top;
      if (nextHeight > availableHeight + .5) break;
      endIndex += 1;
    }
    pages.push(pageWithSystems(intro, normalizedSystems, index, endIndex));
    index = endIndex + 1;
    firstPage = false;
  }
  return { ok: true, pages };
}

export function scoreExportPageDistribution({
  intro = false,
  introHeight = 0,
  startIndex = null,
  endIndex = null,
  chartHeight = 0,
  pageHeight,
  fillThreshold = SCORE_EXPORT_DEFAULT_FILL_THRESHOLD,
} = {}) {
  const safePageHeight = Number(pageHeight);
  const safeIntroHeight = Math.max(0, Number(introHeight) || 0);
  const safeChartHeight = Math.max(0, Number(chartHeight) || 0);
  if (!Number.isFinite(safePageHeight) || safePageHeight <= 0) {
    throw new RangeError("Export page height must be positive.");
  }
  if (startIndex === null || endIndex === null) {
    return { systemGap: 0, sliceHeight: safeChartHeight, chartStartOffset: 0 };
  }

  const safeStartIndex = Math.floor(Number(startIndex));
  const safeEndIndex = Math.floor(Number(endIndex));
  if (!Number.isInteger(safeStartIndex) || !Number.isInteger(safeEndIndex) || safeStartIndex < 0 || safeEndIndex < safeStartIndex) {
    throw new RangeError("Invalid export page system range.");
  }
  const systemCount = safeEndIndex - safeStartIndex + 1;
  const availableHeight = Math.max(0, safePageHeight - (intro ? safeIntroHeight : 0));
  const remainingHeight = availableHeight - safeChartHeight;
  const safeFillThreshold = Math.min(100, Math.max(50, Number(fillThreshold) || SCORE_EXPORT_DEFAULT_FILL_THRESHOLD));
  const naturalPageHeight = safeChartHeight + (intro ? safeIntroHeight : 0);
  const pageFillRatio = naturalPageHeight / safePageHeight;
  if (systemCount < 2 || remainingHeight <= .5 || pageFillRatio + Number.EPSILON < safeFillThreshold / 100) {
    return { systemGap: 0, sliceHeight: safeChartHeight, chartStartOffset: 0 };
  }

  const systemGap = remainingHeight / (systemCount - 1);
  return {
    systemGap,
    sliceHeight: availableHeight,
    chartStartOffset: safeStartIndex * systemGap,
  };
}

export function scoreExportPageNames(baseName, format, pageCount) {
  const safeFormat = SCORE_EXPORT_FORMATS.includes(format) ? format : "pdf";
  const count = Math.max(1, Math.floor(Number(pageCount) || 1));
  const rawName = String(baseName || `untitled.${safeFormat}`);
  const suffixPattern = /\.[^.]+$/;
  const stem = rawName.replace(suffixPattern, "") || "untitled";
  if (safeFormat === "pdf" || count === 1) return [`${stem}.${safeFormat}`];
  return Array.from({ length: count }, (_, index) => `${stem}-p${String(index + 1).padStart(3, "0")}.${safeFormat}`);
}
