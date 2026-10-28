const { requestUserDataReset } = require("./user-data.cjs");

function setupUserDataIpc({ app, ipcMain, shell, dialog, getWindow, assertTrustedSender, confirmDiscard, beforeRestart, tr }) {
  let resetting = false;
  ipcMain.handle("mstruct-user-data:open", async event => {
    assertTrustedSender(event);
    const error = await shell.openPath(app.getPath("userData"));
    if (error) throw Error(error);
    return { opened: true };
  });
  ipcMain.handle("mstruct-user-data:clear", async event => {
    assertTrustedSender(event);
    if (resetting) return { cancelled: true };
    resetting = true;
    try {
      if (!await confirmDiscard()) return { cancelled: true };
      const result = await dialog.showMessageBox(getWindow(), { type: "warning", message: tr("clearUserDataTitle"), detail: tr("clearUserDataDetail"),
        buttons: [tr("cancel"), tr("clearUserDataRestart")], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response !== 1) return { cancelled: true };
      requestUserDataReset(app.getPath("userData"));
      beforeRestart(); app.relaunch(); app.quit();
      return { restarting: true };
    } finally { resetting = false; }
  });
}
module.exports = { setupUserDataIpc };
