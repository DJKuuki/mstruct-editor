const STORAGE_KEY = "mstruct-editor-roman-warnings";

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

/** This personal display preference never changes the document or compiler options. */
export function createEditorWarningSettings({ button, control, onChange, storage = browserStorage() }) {
  let enabled = true;
  try { enabled = storage?.getItem(STORAGE_KEY) !== "false"; } catch { /* Keep the default. */ }
  function reflect() {
    button.setAttribute("aria-checked", String(enabled));
    control.classList.toggle("is-on", enabled);
  }
  button.addEventListener("click", () => {
    enabled = !enabled;
    try { storage?.setItem(STORAGE_KEY, String(enabled)); } catch { /* The session preference still works. */ }
    reflect();
    onChange();
  });
  reflect();
  return { get enabled() { return enabled; } };
}
