const STORAGE_KEY = "mstruct-editor-open-demo-on-startup";

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

/** A local startup preference; changing it never replaces the current document. */
export function createEditorStartupSettings({ row, button, control, status, available, storage = browserStorage() }) {
  let openDemo = true;
  if (available) {
    try { openDemo = storage?.getItem(STORAGE_KEY) !== "false"; } catch { /* Use the default. */ }
  }
  function reflect() {
    row.hidden = !available;
    button.setAttribute("aria-checked", String(openDemo));
    control.classList.toggle("is-on", openDemo);
  }
  button.addEventListener("click", () => {
    if (!available) return;
    try {
      if (!storage) throw new Error("Preference storage unavailable");
      storage.setItem(STORAGE_KEY, String(!openDemo));
      openDemo = !openDemo;
      status.hidden = true;
    } catch {
      status.hidden = false;
    }
    reflect();
  });
  reflect();
  return { get openDemo() { return openDemo; } };
}
