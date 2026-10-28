export function setupResizableToolbox({ handle, layout }) {
  let dragging = false;

  function setHeight(height) {
    const editorHeight = layout.getBoundingClientRect().height;
    const next = Math.min(Math.max(height, 140), Math.max(140, editorHeight - 210));
    layout.style.setProperty("--toolbox-height", `${next}px`);
  }

  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    setHeight(layout.getBoundingClientRect().bottom - event.clientY);
  });
  handle.addEventListener("pointerup", (event) => {
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-resizing");
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const current = Number.parseFloat(getComputedStyle(layout).getPropertyValue("--toolbox-height")) || 180;
    setHeight(current + (event.key === "ArrowUp" ? 20 : -20));
  });
}

export function setupRenderOnResize(render, delay = 120) {
  let timer;
  window.addEventListener("resize", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, delay);
  });
}
