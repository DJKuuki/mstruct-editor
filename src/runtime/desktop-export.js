export function createDesktopExportAdapter(desktopApi) {
  if (!desktopApi) return null;
  return {
    onCommand(callback) {
      desktopApi.onCommand((command) => {
        if (["export:pdf", "export:svg", "export:png", "export:jpg"].includes(command)) callback(command.slice("export:".length));
      });
    },
    prepare(payload) {
      return desktopApi.prepareScoreExport(payload);
    },
    complete(payload) {
      return desktopApi.completeScoreExport(payload);
    },
    cancel(token) {
      desktopApi.cancelScoreExport(token);
    },
  };
}
