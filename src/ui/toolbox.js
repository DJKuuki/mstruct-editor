import { parseToolboxConfigCsv } from "./toolbox-config.js";

function menuName(entry, locale) {
  return locale === "en" ? entry.enName : entry.zhName;
}

function setupPaneResizer({ handle, toolbox, variable, panel, minimum, reserve }) {
  let dragging = false;

  function setSize(size) {
    const available = toolbox.getBoundingClientRect().width;
    const maximum = Math.max(minimum, available - reserve());
    toolbox.style.setProperty(variable, `${Math.min(Math.max(size, minimum), maximum)}px`);
  }

  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-toolbox");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const bounds = panel.getBoundingClientRect();
    setSize(event.clientX - bounds.left);
  });
  handle.addEventListener("pointerup", (event) => {
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-resizing-toolbox");
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setSize(panel.getBoundingClientRect().width + (event.key === "ArrowRight" ? 20 : -20));
  });
}

export function createToolbox({ root, sourceInput, getLocale, onChange, tr, initialConfigCsv }) {
  let configCsv = initialConfigCsv;
  let config = parseToolboxConfigCsv(configCsv);
  let primaryId = config.primaryMenus[0].id;
  let secondaryId = "";
  let primaryScrollTop = 0;
  const secondaryScrollTopByPrimary = new Map();

  function insertEvent(entry) {
    if (sourceInput.disabled) return;
    const start = sourceInput.selectionStart;
    const end = sourceInput.selectionEnd;
    let inputObserved = false;
    const observeInput = () => { inputObserved = true; };
    sourceInput.addEventListener("input", observeInput, { once: true });
    sourceInput.focus();
    sourceInput.setSelectionRange(start, end);
    let insertedWithUndo = false;
    try {
      insertedWithUndo = document.execCommand("insertText", false, entry.insertion);
    } catch {
      insertedWithUndo = false;
    }
    sourceInput.removeEventListener("input", observeInput);
    if (!insertedWithUndo) sourceInput.setRangeText(entry.insertion, start, end, "end");
    const cursor = start + entry.cursorOffset;
    sourceInput.setSelectionRange(cursor, cursor);
    if (!inputObserved) onChange();
  }

  function makeMenuButton(entry, selected, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `toolbox-menu-button${selected ? " is-selected" : ""}`;
    button.textContent = menuName(entry, getLocale());
    button.setAttribute("aria-pressed", String(selected));
    button.addEventListener("click", onClick);
    return button;
  }

  function makeDivider(label, className) {
    const divider = document.createElement("div");
    divider.className = `toolbox-column-resizer ${className}`;
    divider.role = "separator";
    divider.tabIndex = 0;
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute("aria-label", label);
    return divider;
  }

  function render() {
    const currentPrimaryPanel = root.querySelector(".toolbox-primary-menu");
    if (currentPrimaryPanel) primaryScrollTop = currentPrimaryPanel.scrollTop;
    const currentSecondaryPanel = root.querySelector(".toolbox-secondary-menu");
    if (currentSecondaryPanel?.dataset.primaryId) {
      secondaryScrollTopByPrimary.set(currentSecondaryPanel.dataset.primaryId, currentSecondaryPanel.scrollTop);
    }

    const selectedPrimary = config.primaryMenus.find((entry) => entry.id === primaryId) ?? config.primaryMenus[0];
    primaryId = selectedPrimary.id;
    if (secondaryId && !selectedPrimary.secondaryMenus.some((entry) => entry.id === secondaryId)) secondaryId = "";
    if (!selectedPrimary.secondaryMenus.length) secondaryId = "";

    root.classList.toggle("has-secondary-menu", selectedPrimary.secondaryMenus.length > 0);
    root.replaceChildren();

    const primaryPanel = document.createElement("nav");
    primaryPanel.className = "toolbox-menu toolbox-primary-menu";
    primaryPanel.setAttribute("aria-label", tr("toolboxPrimaryMenu"));
    primaryPanel.append(...config.primaryMenus.map((entry) => makeMenuButton(entry, entry.id === primaryId, () => {
      primaryId = entry.id;
      secondaryId = "";
      render();
    })));
    const primaryDivider = makeDivider(tr("resizePrimaryToolboxMenu"), "toolbox-primary-resizer");
    root.append(primaryPanel, primaryDivider);

    let secondaryPanel = null;
    if (selectedPrimary.secondaryMenus.length) {
      secondaryPanel = document.createElement("nav");
      secondaryPanel.className = "toolbox-menu toolbox-secondary-menu";
      secondaryPanel.dataset.primaryId = primaryId;
      secondaryPanel.setAttribute("aria-label", tr("toolboxSecondaryMenu"));
      secondaryPanel.append(...selectedPrimary.secondaryMenus.map((entry) => makeMenuButton(entry, entry.id === secondaryId, () => {
        secondaryId = secondaryId === entry.id ? "" : entry.id;
        render();
      })));
      root.append(secondaryPanel, makeDivider(tr("resizeSecondaryToolboxMenu"), "toolbox-secondary-resizer"));
    }

    const eventPanel = document.createElement("section");
    eventPanel.className = "toolbox-events";
    eventPanel.setAttribute("aria-label", tr("toolboxEvents"));
    const matchingEvents = config.events.filter((entry) => entry.primaryId === primaryId && (!secondaryId || entry.secondaryId === secondaryId));
    if (matchingEvents.length) {
      const grid = document.createElement("div");
      grid.className = "tool-grid";
      for (const entry of matchingEvents) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = menuName(entry, getLocale());
        button.title = entry.insertion;
        button.addEventListener("click", () => insertEvent(entry));
        grid.append(button);
      }
      eventPanel.append(grid);
    } else {
      const empty = document.createElement("p");
      empty.className = "toolbox-empty";
      empty.textContent = tr("toolboxEmpty");
      eventPanel.append(empty);
    }
    root.append(eventPanel);
    primaryPanel.scrollTop = primaryScrollTop;
    if (secondaryPanel) secondaryPanel.scrollTop = secondaryScrollTopByPrimary.get(primaryId) ?? 0;

    setupPaneResizer({
      handle: primaryDivider,
      toolbox: root,
      variable: "--primary-menu-width",
      panel: primaryPanel,
      minimum: 104,
      reserve: () => (secondaryPanel ? secondaryPanel.getBoundingClientRect().width + 151 : 151),
    });
    const secondaryDivider = root.querySelector(".toolbox-secondary-resizer");
    if (secondaryDivider && secondaryPanel) setupPaneResizer({
      handle: secondaryDivider,
      toolbox: root,
      variable: "--secondary-menu-width",
      panel: secondaryPanel,
      minimum: 104,
      reserve: () => primaryPanel.getBoundingClientRect().width + 151,
    });
  }

  function setConfigCsv(value) {
    try {
      const next = parseToolboxConfigCsv(value);
      configCsv = value;
      config = next;
      render();
      return true;
    } catch {
      return false;
    }
  }

  render();
  return { refreshLocale: render, setConfigCsv, getConfigCsv: () => configCsv };
}
