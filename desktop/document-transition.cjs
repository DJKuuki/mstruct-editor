const { randomUUID } = require("node:crypto");

/** Confirm leaving a dirty workspace; the renderer owns serialization and save order. */
function createDocumentTransition({ ipcMain, assertTrustedSender, getWindow, isDirty, dialog, tr }) {
  let pending = null, busy = false;
  function requestSave(window) {
    return new Promise(resolve => {
      const token = randomUUID(), contents = window.webContents;
      const finish = saved => {
        if (pending?.token !== token) return;
        pending = null;
        contents.removeListener("destroyed", cancelled); contents.removeListener("render-process-gone", cancelled);
        resolve(saved);
      };
      const cancelled = () => finish(false);
      pending = { token, contents, finish };
      contents.once("destroyed", cancelled); contents.once("render-process-gone", cancelled);
      try { contents.send("mstruct:save-before-transition", token); } catch { finish(false); }
    });
  }
  ipcMain.handle("mstruct:complete-transition-save", (event, result) => {
    assertTrustedSender(event);
    if (!pending || event.sender !== pending.contents || result?.token !== pending.token) return false;
    pending.finish(result.saved === true && !isDirty());
    return true;
  });
  return {
    async confirm(action) {
      if (busy) return false;
      const window = getWindow();
      if (!isDirty() || !window) return true;
      busy = true;
      try {
        const result = await dialog.showMessageBox(window, { type: "warning", title: tr("unsaved"), message: tr("unsavedMessage"),
          detail: tr("unsavedDetail", { action }), buttons: [tr("saveAction", { action }), tr("discardAction", { action }), tr("cancel")],
          defaultId: 0, cancelId: 2, noLink: true });
        if (result.response === 1) return true;
        if (result.response !== 0 || window.isDestroyed()) return false;
        return await requestSave(window);
      } catch { return false; }
      finally { busy = false; }
    },
  };
}
module.exports = { createDocumentTransition };
