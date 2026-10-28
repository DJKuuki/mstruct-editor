export function createDesktopExportAdapter(desktopApi) {
  if (!desktopApi) return null;
  return {
    onCommand(callback) {
      desktopApi.onCommand((command) => {
        if (typeof command === "string" && command.startsWith("export:")) callback(command.slice("export:".length));
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
