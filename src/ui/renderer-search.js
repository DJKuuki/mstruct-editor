import { projectMstructSearchEvents } from "../core/mstruct-search-events.js";
import { matchMstructSearchQuery } from "../core/mstruct-search-match.js";
import { parseMstructSearchQuery } from "../core/mstruct-search-query.js";

const ERROR_COPY = {
  "search-query-too-long": "rendererSearchErrorTooLong",
  "search-event-limit": "rendererSearchErrorTooComplex",
  "search-field-pattern-too-complex": "rendererSearchErrorTooComplex",
  "search-global-tag-limit": "rendererSearchErrorTooComplex",
  "search-query-too-complex": "rendererSearchErrorTooComplex",
  "search-or-limit": "rendererSearchErrorTooComplex",
  "search-not-limit": "rendererSearchErrorTooComplex",
  "search-not-invalid": "rendererSearchErrorNot",
  "search-or-invalid": "rendererSearchErrorOr",
  "search-or-nested": "rendererSearchErrorOr",
  "search-or-empty-branch": "rendererSearchErrorOr",
  "search-or-event-span": "rendererSearchErrorOr",
  "search-empty-event": "rendererSearchErrorEmptyEvent",
  "search-option-unknown": "rendererSearchErrorOption",
  "search-option-duplicate": "rendererSearchErrorOption",
  "search-global-tag-option": "rendererSearchErrorOption",
  "search-tag-invalid": "rendererSearchErrorTag",
  "search-setting-invalid": "rendererSearchErrorSetting",
  "search-setting-unknown": "rendererSearchErrorSetting",
  "search-setting-duplicate": "rendererSearchErrorSetting",
  "search-new-riemannian-invalid": "rendererSearchErrorSetting",
  "search-token-unclosed": "rendererSearchErrorToken",
  "search-harmony-form": "rendererSearchErrorHarmony",
  "search-field-pattern-invalid": "rendererSearchErrorPattern",
  "search-relative-note-invalid": "rendererSearchErrorPattern",
  "search-note-set-invalid": "rendererSearchErrorNotes",
  "search-continuation-unsearchable": "rendererSearchErrorContinuation",
};

function eventOrder(eventId) {
  return String(eventId).startsWith("event:") ? String(eventId).slice("event:".length) : null;
}

function visualSearchElement(element) {
  return element.closest(".modulation-pair")
    ?? element.closest(".tonal-cluster")
    ?? element.closest(".event-value-with-annotation")
    ?? element;
}

export function searchHighlightBox(rects, chartRect, { paddingInline = 3, paddingBlock = 2 } = {}) {
  const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (!visible.length) return null;
  const left = Math.min(...visible.map((rect) => rect.left)) - chartRect.left - paddingInline;
  const top = Math.min(...visible.map((rect) => rect.top)) - chartRect.top - paddingBlock;
  const right = Math.max(...visible.map((rect) => rect.right)) - chartRect.left + paddingInline;
  const bottom = Math.max(...visible.map((rect) => rect.bottom)) - chartRect.top + paddingBlock;
  return { left, top, width: right - left, height: bottom - top };
}

function appendRange(layer, chartRect, elements, current, windowIndex) {
  const rects = [...new Set(elements.map(visualSearchElement))]
    .map((element) => element.getBoundingClientRect());
  const box = searchHighlightBox(rects, chartRect);
  if (!box) return;
  const range = document.createElement("span");
  range.className = `renderer-search-range${current ? " is-current" : ""}`;
  range.dataset.searchWindowIndex = String(windowIndex);
  range.style.left = `${box.left}px`;
  range.style.top = `${box.top}px`;
  range.style.width = `${box.width}px`;
  range.style.height = `${box.height}px`;
  layer.append(range);
}

export function createRendererSearch({
  canvas,
  button,
  panel,
  input,
  previousButton,
  count,
  nextButton,
  error,
  closeButton,
  tr,
  getQueryOptions,
  requestScroll,
  postToHost,
}) {
  let projection = null;
  let windows = [];
  let currentIndex = -1;
  let lastSource = "";
  let lastExecutedSource = "";
  let lastError = null;
  let validationOnly = false;

  function searchElements(eventIds) {
    const orders = new Set(eventIds.map(eventOrder).filter(Boolean));
    return [...canvas.querySelectorAll("[data-event-order]")]
      .filter((element) => orders.has(element.dataset.eventOrder));
  }

  function clearHighlights() {
    canvas.querySelector(".renderer-search-highlight-layer")?.remove();
    for (const element of canvas.querySelectorAll(".is-search-match, .is-search-current")) {
      element.classList.remove("is-search-match", "is-search-current");
    }
  }

  function reflectHighlights() {
    clearHighlights();
    const chart = canvas.querySelector(".chart");
    if (!chart || !windows.length) return;
    const chartRect = chart.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "renderer-search-highlight-layer";
    for (const [windowIndex, window] of windows.entries()) {
      const bySystem = new Map();
      for (const element of searchElements(window.eventIds)) {
        const system = element.closest(".score-system");
        if (!system) continue;
        const elements = bySystem.get(system) ?? [];
        elements.push(element);
        bySystem.set(system, elements);
      }
      for (const elements of bySystem.values()) appendRange(layer, chartRect, elements, windowIndex === currentIndex, windowIndex);
    }
    chart.append(layer);
  }

  function errorMessage(value) {
    if (!value) return "";
    const message = tr(ERROR_COPY[value.code] ?? "rendererSearchErrorGeneric");
    return tr("rendererSearchErrorAt", { position: value.start + 1, message });
  }

  function reflect({ scroll = false } = {}) {
    reflectHighlights();
    count.textContent = `${currentIndex >= 0 ? currentIndex + 1 : 0} / ${windows.length}`;
    previousButton.disabled = !windows.length;
    nextButton.disabled = !windows.length;
    const message = errorMessage(lastError);
    error.hidden = !message;
    error.textContent = message;
    input.setAttribute("aria-invalid", String(Boolean(message)));
    button.setAttribute("aria-pressed", String(!panel.hidden));
    postToHost("search-state", {
      search: {
        query: lastSource,
        current: currentIndex >= 0 ? currentIndex + 1 : 0,
        total: windows.length,
        error: message,
        validationOnly,
      },
    });
    if (!scroll || currentIndex < 0) return;
    const targetId = windows[currentIndex].matchedEventIds[0];
    const [target] = searchElements([targetId]);
    if (target) requestScroll(target);
  }

  function resetResults({ clearInput = false } = {}) {
    windows = [];
    currentIndex = -1;
    lastSource = "";
    lastExecutedSource = "";
    lastError = null;
    validationOnly = false;
    if (clearInput) input.value = "";
    reflect();
  }

  function execute(source, { advance = true, scroll = true } = {}) {
    const normalized = String(source ?? "").trim();
    if (!normalized) {
      resetResults();
      return;
    }
    if (advance && normalized === lastExecutedSource && !lastError && windows.length) {
      currentIndex = (currentIndex + 1) % windows.length;
      reflect({ scroll });
      return;
    }

    const query = parseMstructSearchQuery(normalized, getQueryOptions());
    lastSource = normalized;
    lastError = query.errors[0] ?? null;
    validationOnly = false;
    if (!query.ok || !projection) {
      windows = [];
      currentIndex = -1;
      lastExecutedSource = "";
      reflect();
      return;
    }
    windows = matchMstructSearchQuery(query, projection).windows;
    currentIndex = windows.length ? 0 : -1;
    lastExecutedSource = normalized;
    reflect({ scroll });
  }

  function validateSource(source) {
    const normalized = String(source ?? "").trim();
    if (!normalized) {
      resetResults();
      return;
    }
    const query = parseMstructSearchQuery(normalized, getQueryOptions());
    lastSource = normalized;
    lastError = query.errors[0] ?? null;
    validationOnly = true;
    if (normalized !== lastExecutedSource || lastError) {
      windows = [];
      currentIndex = -1;
      lastExecutedSource = "";
    }
    reflect();
  }

  function navigate(delta) {
    if (!windows.length) return;
    currentIndex = (currentIndex + delta + windows.length) % windows.length;
    reflect({ scroll: true });
  }

  function open() {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-pressed", "true");
    input.focus();
    input.select();
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    resetResults({ clearInput: true });
    button.focus();
  }

  function handleInputKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    execute(input.value);
  }

  function handleInput() {
    validateSource(input.value);
  }

  function toggle() {
    if (panel.hidden) open();
    else close();
  }

  function goToPrevious() {
    navigate(-1);
  }

  function goToNext() {
    navigate(1);
  }

  button.addEventListener("click", toggle);
  previousButton.addEventListener("click", goToPrevious);
  nextButton.addEventListener("click", goToNext);
  closeButton.addEventListener("click", close);
  input.addEventListener("keydown", handleInputKeydown);
  input.addEventListener("input", handleInput);

  return {
    refreshLocale() {
      if (lastError) reflect();
    },
    updateDocument(result) {
      projection = result?.ok ? projectMstructSearchEvents(result, { globalTags: result.globalTags ?? [] }) : null;
      if (lastExecutedSource && lastSource === lastExecutedSource) execute(lastExecutedSource, { advance: false, scroll: false });
      else if (lastSource) validateSource(lastSource);
      else resetResults();
    },
    refreshRenderedScore() {
      reflectHighlights();
    },
    run(source, { advance = true } = {}) {
      input.value = String(source ?? "");
      if (!panel.hidden) input.focus();
      execute(input.value, { advance });
    },
    validate(source) {
      input.value = String(source ?? "");
      validateSource(input.value);
    },
    navigate,
    clear: resetResults,
    destroy() {
      clearHighlights();
      button.removeEventListener("click", toggle);
      previousButton.removeEventListener("click", goToPrevious);
      nextButton.removeEventListener("click", goToNext);
      closeButton.removeEventListener("click", close);
      input.removeEventListener("keydown", handleInputKeydown);
      input.removeEventListener("input", handleInput);
    },
  };
}
