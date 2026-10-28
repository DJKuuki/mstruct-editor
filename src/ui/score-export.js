import {
  SCORE_EXPORT_BARLINE_WIDTH_PX,
  SCORE_EXPORT_FORMATS,
  SCORE_EXPORT_STORAGE_KEY,
  normalizeScoreExportSettings,
  paginateScoreSystems,
  resolveScoreExportCssUrl,
  scoreExportContinuousGeometry,
  scoreExportGeometry,
  scoreExportPageDistribution,
  scoreExportRasterGeometryAllowed,
} from "../core/score-export.js";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settledLayout() {
  await document.fonts?.ready;
  await nextFrame();
  await nextFrame();
}

function readSettings() {
  try {
    return normalizeScoreExportSettings(JSON.parse(localStorage.getItem(SCORE_EXPORT_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeScoreExportSettings();
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(SCORE_EXPORT_STORAGE_KEY, JSON.stringify(normalizeScoreExportSettings(settings)));
  } catch {
    // Export still works when local storage is unavailable.
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

function styleSheetText(sheet) {
  try {
    return {
      baseUrl: sheet.href || document.baseURI,
      text: [...sheet.cssRules].map((rule) => rule.cssText).join("\n"),
    };
  } catch {
    return null;
  }
}

const resourceDataUrls = new Map();
async function resourceDataUrl(url) {
  if (!resourceDataUrls.has(url)) {
    resourceDataUrls.set(url, (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to embed export resource: ${url}`);
      const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
      const data = arrayBufferToBase64(await response.arrayBuffer());
      return `data:${mimeType};base64,${data}`;
    })());
  }
  try {
    return await resourceDataUrls.get(url);
  } catch (error) {
    resourceDataUrls.delete(url);
    throw error;
  }
}

async function inlineCssResources(cssText, baseUrl) {
  const matches = [...cssText.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)];
  const replacements = new Map();
  for (const match of matches) {
    const source = match[2].trim();
    if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith("#")) continue;
    let resolved;
    try {
      resolved = resolveScoreExportCssUrl(source, baseUrl, document.baseURI);
    } catch {
      continue;
    }
    if (replacements.has(match[0])) continue;
    replacements.set(match[0], `url("${await resourceDataUrl(resolved)}")`);
  }
  let inlined = cssText;
  for (const [source, replacement] of replacements) inlined = inlined.split(source).join(replacement);
  return inlined;
}

let selfContainedCssPromise = null;
function selfContainedCss() {
  if (!selfContainedCssPromise) {
    const sheets = [...document.styleSheets].map(styleSheetText).filter(Boolean);
    selfContainedCssPromise = Promise.all(sheets.map((sheet) => inlineCssResources(sheet.text, sheet.baseUrl)))
      .then((parts) => parts.join("\n"))
      .catch((error) => {
        selfContainedCssPromise = null;
        throw error;
      });
  }
  return selfContainedCssPromise;
}

function pageMarkup(page) {
  const clone = page.cloneNode(true);
  clone.hidden = false;
  clone.removeAttribute("hidden");
  return new XMLSerializer().serializeToString(clone);
}

function pageSvg(page, geometry, cssText) {
  const clone = page.cloneNode(true);
  clone.hidden = false;
  clone.removeAttribute("hidden");
  clone.setAttribute("xmlns", XHTML_NAMESPACE);
  const markup = new XMLSerializer().serializeToString(clone);
  const safeCss = cssText.replaceAll("]]>", "]]]]><![CDATA[>");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.widthMm}mm" height="${geometry.heightMm}mm" viewBox="0 0 ${geometry.pageWidthPx} ${geometry.pageHeightPx}"><rect width="100%" height="100%" fill="#fff"/><foreignObject x="0" y="0" width="${geometry.pageWidthPx}" height="${geometry.pageHeightPx}"><div xmlns="${XHTML_NAMESPACE}" class="score-export-svg-root"><style type="text/css"><![CDATA[${safeCss}]]></style>${markup}</div></foreignObject></svg>`;
}

function makeElement(tagName, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}

export function setupScoreExport({
  dialog,
  adapter,
  tr,
  getLocale,
  prepareScore,
  getSuggestedName,
  layoutScoreSystems,
  renderSystem,
  markEndingSystems,
  drawEndingBrackets,
  drawRomanVoiceLeadingLines,
  drawNewRiemannianConnections,
  drawTagRangeLines,
  drawCommentRangeLines,
  renderDocumentHeader,
  renderGlobalTags,
  setEditorStatus,
}) {
  if (!adapter || !dialog) return null;
  const formatSelect = dialog.querySelector("#scoreExportFormat");
  const outputModeSelect = dialog.querySelector("#scoreExportOutputMode");
  const pngBackgroundField = dialog.querySelector("#scoreExportPngBackgroundField");
  const pngBackgroundSelect = dialog.querySelector("#scoreExportPngBackground");
  const paperSelect = dialog.querySelector("#scoreExportPaper");
  const orientationSelect = dialog.querySelector("#scoreExportOrientation");
  const marginSelect = dialog.querySelector("#scoreExportMargin");
  const fillThresholdField = dialog.querySelector("#scoreExportFillThresholdField");
  const fillThresholdInput = dialog.querySelector("#scoreExportFillThreshold");
  const fillThresholdOutput = dialog.querySelector("#scoreExportFillThresholdValue");
  const scaleInput = dialog.querySelector("#scoreExportScale");
  const scaleOutput = dialog.querySelector("#scoreExportScaleValue");
  const scaleReset = dialog.querySelector("#scoreExportScaleReset");
  const closeButton = dialog.querySelector("#scoreExportClose");
  const cancelButton = dialog.querySelector("#scoreExportCancel");
  const submitButton = dialog.querySelector("#scoreExportSubmit");
  const previousButton = dialog.querySelector("#scoreExportPrevious");
  const nextButton = dialog.querySelector("#scoreExportNext");
  const pageCount = dialog.querySelector("#scoreExportPageCount");
  const fitButton = dialog.querySelector("#scoreExportFit");
  const actualButton = dialog.querySelector("#scoreExportActual");
  const previewScroll = dialog.querySelector("#scoreExportPreviewScroll");
  const previewStage = dialog.querySelector("#scoreExportPreviewStage");
  const pagesRoot = dialog.querySelector("#scoreExportPages");
  const measureRoot = dialog.querySelector("#scoreExportMeasureRoot");
  const status = dialog.querySelector("#scoreExportStatus");
  const printStyle = document.querySelector("#scoreExportPrintStyle");
  let settings = readSettings();
  let geometry = scoreExportGeometry(settings);
  let outputGeometry = geometry;
  let pages = [];
  let currentPage = 0;
  let previewMode = "fit";
  let buildRevision = 0;
  let readyRevision = 0;
  let exporting = false;

  function setStatus(message, ok = true) {
    status.textContent = message;
    status.className = `score-export-status ${ok ? "is-success" : "is-error"}`;
  }

  function syncConditionalControls() {
    const paginated = settings.pagination === "pages";
    pngBackgroundField.hidden = settings.format !== "png";
    pngBackgroundSelect.disabled = settings.format !== "png";
    fillThresholdField.hidden = !paginated;
    fillThresholdInput.disabled = !paginated;
  }

  function readControls() {
    const format = formatSelect.value;
    settings = normalizeScoreExportSettings({
      format,
      paper: paperSelect.value,
      orientation: orientationSelect.value,
      margin: marginSelect.value,
      scale: scaleInput.value,
      pagination: format === "pdf" ? "pages" : outputModeSelect.value,
      fillThreshold: fillThresholdInput.value,
      pngBackground: pngBackgroundSelect.value,
    });
    writeSettings(settings);
    outputModeSelect.value = settings.pagination;
    outputModeSelect.disabled = settings.format === "pdf";
    pngBackgroundSelect.value = settings.pngBackground;
    fillThresholdInput.value = String(settings.fillThreshold);
    fillThresholdOutput.value = `${settings.fillThreshold}%`;
    scaleOutput.value = `${settings.scale}%`;
    syncConditionalControls();
    geometry = scoreExportGeometry(settings);
    outputGeometry = geometry;
    printStyle.textContent = `@page { size: ${geometry.widthMm}mm ${geometry.heightMm}mm; margin: 0; }`;
  }

  function writeControls() {
    formatSelect.value = settings.format;
    outputModeSelect.value = settings.format === "pdf" ? "pages" : settings.pagination;
    outputModeSelect.disabled = settings.format === "pdf";
    pngBackgroundSelect.value = settings.pngBackground;
    paperSelect.value = settings.paper;
    orientationSelect.value = settings.orientation;
    marginSelect.value = settings.margin;
    fillThresholdInput.value = String(settings.fillThreshold);
    fillThresholdOutput.value = `${settings.fillThreshold}%`;
    scaleInput.value = String(settings.scale);
    scaleOutput.value = `${settings.scale}%`;
    syncConditionalControls();
  }

  function updatePageVisibility() {
    pages.forEach((page, index) => { page.hidden = index !== currentPage; });
    pageCount.value = pages.length ? `${currentPage + 1} / ${pages.length}` : "0 / 0";
    previousButton.disabled = currentPage <= 0;
    nextButton.disabled = currentPage >= pages.length - 1;
    applyPreviewZoom();
  }

  function applyPreviewZoom() {
    const page = pages[currentPage];
    if (!page) return;
    let zoom = 1;
    if (previewMode === "fit") {
      const availableWidth = Math.max(1, previewScroll.clientWidth - 44);
      const availableHeight = Math.max(1, previewScroll.clientHeight - 44);
      zoom = settings.pagination === "continuous"
        ? Math.min(1, availableWidth / outputGeometry.pageWidthPx)
        : Math.min(1, availableWidth / outputGeometry.pageWidthPx, availableHeight / outputGeometry.pageHeightPx);
    }
    previewStage.style.zoom = String(zoom);
    fitButton.setAttribute("aria-pressed", String(previewMode === "fit"));
    actualButton.setAttribute("aria-pressed", String(previewMode === "actual"));
  }

  function vectorizeBarlines(chart) {
    for (const boundary of chart.querySelectorAll(".measure-barline, .control-boundary.is-double-bar")) {
      const rect = boundary.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const svg = document.createElementNS(SVG_NAMESPACE, "svg");
      svg.classList.add("score-export-barline-vector");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("aria-hidden", "true");

      const lines = [];
      if (boundary.classList.contains("is-double-bar")) {
        for (const pseudo of ["::before", "::after"]) {
          const style = getComputedStyle(boundary, pseudo);
          const lineWidth = Math.max(.01, parseFloat(style.width) || rect.width || 1);
          const logicalLeft = parseFloat(style.getPropertyValue("inset-inline-start"));
          const physicalLeft = parseFloat(style.left);
          const left = Number.isFinite(logicalLeft) ? logicalLeft : (Number.isFinite(physicalLeft) ? physicalLeft : 0);
          lines.push({ x: left + lineWidth / 2, width: lineWidth });
        }
      } else {
        lines.push({ x: rect.width / 2, width: rect.width });
      }
      for (const definition of lines) {
        const line = document.createElementNS(SVG_NAMESPACE, "line");
        line.setAttribute("x1", String(definition.x));
        line.setAttribute("x2", String(definition.x));
        line.setAttribute("y1", "0");
        line.setAttribute("y2", String(height));
        line.setAttribute("stroke", "#31433d");
        line.setAttribute("stroke-width", String(definition.width));
        line.setAttribute("stroke-linecap", "butt");
        line.setAttribute("shape-rendering", "geometricPrecision");
        svg.append(line);
      }
      boundary.classList.add("score-export-vectorized-barline");
      boundary.prepend(svg);
    }
  }

  function systemVisualBounds(system, chartRect) {
    const systemRect = system.getBoundingClientRect();
    let top = systemRect.top;
    let bottom = systemRect.bottom;
    for (const descendant of system.querySelectorAll("*")) {
      const rect = descendant.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    return { top: top - chartRect.top, bottom: bottom - chartRect.top };
  }

  function makePage(pageDefinition, fullChart, introNodes, introHeight) {
    const page = makeElement("section", "score-export-page");
    page.classList.toggle("is-transparent-preview", settings.format === "png" && settings.pngBackground === "transparent");
    page.setAttribute("aria-label", tr("scoreExportPreview"));
    page.style.width = `${outputGeometry.pageWidthPx}px`;
    page.style.height = `${outputGeometry.pageHeightPx}px`;
    page.style.padding = `${outputGeometry.marginPx}px`;
    page.dataset.widthMm = String(outputGeometry.widthMm);
    page.dataset.heightMm = String(outputGeometry.heightMm);

    const content = makeElement("div", "score-export-page-content");
    content.style.width = `${outputGeometry.logicalWidthPx}px`;
    content.style.height = `${outputGeometry.logicalHeightPx}px`;
    content.style.transform = `scale(${outputGeometry.scaleFactor})`;
    content.style.setProperty("--score-export-barline-width", `${SCORE_EXPORT_BARLINE_WIDTH_PX / outputGeometry.scaleFactor}px`);
    if (pageDefinition.intro && introNodes.length) {
      const intro = makeElement("div", "score-export-page-intro");
      intro.style.height = `${introHeight}px`;
      for (const node of introNodes) intro.append(node.cloneNode(true));
      content.append(intro);
    }
    if (pageDefinition.startIndex !== null) {
      const slice = makeElement("div", "score-export-chart-slice");
      slice.style.height = `${pageDefinition.sliceHeight ?? pageDefinition.chartHeight}px`;
      const chart = fullChart.cloneNode(true);
      chart.classList.add("score-export-page-chart");
      const systemGap = Math.max(0, Number(pageDefinition.systemGap) || 0);
      if (systemGap > 0) {
        const baseSystemGap = Number.parseFloat(getComputedStyle(fullChart).rowGap) || 0;
        chart.style.rowGap = `${baseSystemGap + systemGap}px`;
        chart.dataset.exportDistributed = "true";
        for (const layer of chart.querySelectorAll(".ending-bracket-layer, .roman-voice-leading-layer, .new-riemannian-layer, .tag-range-layer, .comment-range-layer")) {
          layer.remove();
        }
      }
      chart.style.transform = `translateY(${-(pageDefinition.chartStart + (pageDefinition.chartStartOffset ?? 0))}px)`;
      slice.append(chart);
      content.append(slice);
    }
    page.append(content);
    return page;
  }

  function redrawDistributedPageOverlays(page, result) {
    const chart = page.querySelector('.score-export-page-chart[data-export-distributed="true"]');
    if (!chart) return;
    const content = page.querySelector(".score-export-page-content");
    const contentTransform = content?.style.transform ?? "";
    const chartTransform = chart.style.transform;
    if (content) content.style.transform = "none";
    chart.style.transform = "none";
    try {
      drawRomanVoiceLeadingLines(chart);
      drawNewRiemannianConnections(chart);
      drawTagRangeLines(chart);
      drawCommentRangeLines(chart);
      drawEndingBrackets(chart, result);
    } finally {
      if (content) content.style.transform = contentTransform;
      chart.style.transform = chartTransform;
    }
  }

  async function rebuildPreview() {
    const revision = ++buildRevision;
    readControls();
    readyRevision = 0;
    submitButton.disabled = true;
    previewStage.style.zoom = "1";
    pagesRoot.replaceChildren();
    pages = [];
    currentPage = 0;
    setStatus(tr("scoreExportPreparing"));
    const result = prepareScore();
    if (!result?.ok) {
      setStatus(tr("scoreExportInvalid"), false);
      return;
    }

    measureRoot.replaceChildren();
    measureRoot.style.width = `${geometry.logicalWidthPx}px`;
    const measureContent = makeElement("div", "score-export-measure-content");
    measureContent.style.setProperty("--score-font-size", "16px");
    measureContent.style.setProperty("--score-export-barline-width", `${SCORE_EXPORT_BARLINE_WIDTH_PX / geometry.scaleFactor}px`);
    const introNodes = [];
    const header = renderDocumentHeader();
    if (header) introNodes.push(header);
    const globalTags = renderGlobalTags(result.globalTags);
    if (globalTags) introNodes.push(globalTags);
    introNodes.forEach((node) => measureContent.append(node));
    const chart = makeElement("div", "chart");
    chart.style.width = `${geometry.logicalScoreWidthPx}px`;
    chart.style.marginInline = `${geometry.logicalHorizontalSafeInsetPx}px`;
    const systemLayouts = result.flow?.length ? layoutScoreSystems(result, geometry.logicalScoreWidthPx) : [];
    for (const system of systemLayouts) chart.append(renderSystem(system));
    markEndingSystems(chart, result);
    if (!chart.childElementCount) {
      const incomplete = makeElement("p", "incomplete-note");
      incomplete.textContent = tr("incomplete");
      chart.append(incomplete);
    }
    measureContent.append(chart);
    measureRoot.append(measureContent);
    await settledLayout();
    if (revision !== buildRevision) return;
    vectorizeBarlines(chart);
    drawRomanVoiceLeadingLines(chart);
    drawNewRiemannianConnections(chart);
    drawTagRangeLines(chart);
    drawCommentRangeLines(chart);
    drawEndingBrackets(chart, result);
    await settledLayout();
    if (revision !== buildRevision) return;

    const contentRect = measureContent.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    const systemNodes = [...chart.querySelectorAll(":scope > .score-system")];
    const bounds = systemNodes.map((system) => systemVisualBounds(system, chartRect));
    let introHeight = Math.max(0, chartRect.top - contentRect.top);
    if (bounds.length) introHeight = Math.max(0, introHeight + Math.min(0, bounds[0].top));
    if (!systemNodes.length) {
      introNodes.push(chart);
      introHeight = Math.max(0, contentRect.height);
    }
    if (settings.pagination === "continuous") {
      const firstTop = bounds[0]?.top ?? 0;
      const chartHeight = bounds.length ? bounds.at(-1).bottom - firstTop : 0;
      outputGeometry = scoreExportContinuousGeometry(geometry, introHeight + chartHeight);
      if (["png", "jpg"].includes(settings.format) && !scoreExportRasterGeometryAllowed(outputGeometry)) {
        measureRoot.replaceChildren();
        setStatus(tr("scoreExportRasterTooLarge"), false);
        return;
      }
      const definition = {
        intro: true,
        startIndex: bounds.length ? 0 : null,
        endIndex: bounds.length ? bounds.length - 1 : null,
        chartStart: firstTop,
        chartHeight,
      };
      pagesRoot.append(makePage(definition, chart, introNodes, introHeight));
      measureRoot.replaceChildren();
      pages = [...pagesRoot.querySelectorAll(":scope > .score-export-page")];
      readyRevision = revision;
      submitButton.disabled = false;
      setStatus(tr("scoreExportContinuousReady"));
      updatePageVisibility();
      return;
    }

    outputGeometry = geometry;
    const pagination = paginateScoreSystems({ introHeight, systems: bounds, pageHeight: outputGeometry.logicalHeightPx });
    if (!pagination.ok) {
      measureRoot.replaceChildren();
      setStatus(tr(pagination.reason === "intro-too-tall" ? "scoreExportIntroTooTall" : "scoreExportSystemTooTall"), false);
      return;
    }
    for (const definition of pagination.pages) {
      const distribution = scoreExportPageDistribution({
        ...definition,
        introHeight,
        pageHeight: outputGeometry.logicalHeightPx,
        fillThreshold: settings.fillThreshold,
      });
      pagesRoot.append(makePage({ ...definition, ...distribution }, chart, introNodes, introHeight));
    }
    await settledLayout();
    if (revision !== buildRevision) return;
    for (const page of pagesRoot.querySelectorAll(":scope > .score-export-page")) redrawDistributedPageOverlays(page, result);
    await settledLayout();
    if (revision !== buildRevision) return;
    measureRoot.replaceChildren();
    pages = [...pagesRoot.querySelectorAll(":scope > .score-export-page")];
    readyRevision = revision;
    submitButton.disabled = false;
    setStatus(tr("scoreExportReady", { count: pages.length }));
    updatePageVisibility();
  }

  function scheduleRebuild() {
    void rebuildPreview().catch(() => {
      measureRoot.replaceChildren();
      setStatus(tr("scoreExportFailed"), false);
    });
  }

  async function exportPages(event) {
    event.preventDefault();
    if (exporting || !pages.length || readyRevision !== buildRevision) return;
    exporting = true;
    submitButton.disabled = true;
    setStatus(tr("scoreExportWriting"));
    let token = "";
    try {
      const prepared = await adapter.prepare({
        format: settings.format,
        pageCount: pages.length,
        rasterWidthPx: outputGeometry.rasterWidthPx,
        rasterHeightPx: outputGeometry.rasterHeightPx,
        pageWidthPx: outputGeometry.pageWidthPx,
        pageHeightPx: outputGeometry.pageHeightPx,
        pngBackground: settings.pngBackground,
        suggestedName: getSuggestedName(),
        locale: getLocale(),
      });
      if (prepared.cancelled) {
        setStatus(tr("scoreExportCancelled"));
        return;
      }
      token = prepared.token;
      let result;
      if (settings.format === "pdf") {
        document.body.classList.add("score-export-printing");
        await settledLayout();
        result = await adapter.complete({ token });
      } else {
        const cssText = await selfContainedCss();
        if (settings.format === "svg") {
          result = await adapter.complete({ token, pages: pages.map((page) => pageSvg(page, outputGeometry, cssText)) });
        } else {
          result = await adapter.complete({ token, cssText, pages: pages.map(pageMarkup) });
        }
      }
      token = "";
      const message = tr("scoreExportComplete", { names: result.names.join(", ") });
      setStatus(message);
      setEditorStatus(message, true);
    } catch (error) {
      console.error("Score export failed.", error);
      if (token) adapter.cancel(token);
      const message = tr("scoreExportFailedWithReason", { reason: error instanceof Error ? error.message : String(error) });
      setStatus(message, false);
      setEditorStatus(message, false);
    } finally {
      document.body.classList.remove("score-export-printing");
      exporting = false;
      submitButton.disabled = readyRevision !== buildRevision || !pages.length;
    }
  }

  function open(format) {
    if (!SCORE_EXPORT_FORMATS.includes(format)) return;
    settings = normalizeScoreExportSettings({ ...readSettings(), format });
    writeControls();
    if (!dialog.open) dialog.showModal();
    scheduleRebuild();
  }

  function close() {
    if (exporting) return;
    buildRevision += 1;
    measureRoot.replaceChildren();
    pagesRoot.replaceChildren();
    pages = [];
    if (dialog.open) dialog.close();
  }

  for (const control of [formatSelect, outputModeSelect, pngBackgroundSelect, paperSelect, orientationSelect, marginSelect]) control.addEventListener("change", scheduleRebuild);
  fillThresholdInput.addEventListener("input", () => {
    const next = normalizeScoreExportSettings({ ...settings, fillThreshold: fillThresholdInput.value });
    fillThresholdOutput.value = `${next.fillThreshold}%`;
  });
  fillThresholdInput.addEventListener("change", scheduleRebuild);
  scaleInput.addEventListener("input", () => {
    const next = normalizeScoreExportSettings({ ...settings, scale: scaleInput.value });
    scaleOutput.value = `${next.scale}%`;
  });
  scaleInput.addEventListener("change", scheduleRebuild);
  scaleReset.addEventListener("click", () => { scaleInput.value = "100"; scheduleRebuild(); });
  previousButton.addEventListener("click", () => { currentPage = Math.max(0, currentPage - 1); updatePageVisibility(); });
  nextButton.addEventListener("click", () => { currentPage = Math.min(pages.length - 1, currentPage + 1); updatePageVisibility(); });
  fitButton.addEventListener("click", () => { previewMode = "fit"; applyPreviewZoom(); });
  actualButton.addEventListener("click", () => { previewMode = "actual"; applyPreviewZoom(); });
  closeButton.addEventListener("click", close);
  cancelButton.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.querySelector("form").addEventListener("submit", exportPages);
  const resizeObserver = new ResizeObserver(applyPreviewZoom);
  resizeObserver.observe(previewScroll);
  adapter.onCommand(open);

  return {
    close,
    refreshLocale() {
      fillThresholdOutput.value = `${settings.fillThreshold}%`;
      scaleOutput.value = `${settings.scale}%`;
      updatePageVisibility();
    },
    destroy() {
      buildRevision += 1;
      resizeObserver.disconnect();
      measureRoot.replaceChildren();
      pagesRoot.replaceChildren();
    },
  };
}
