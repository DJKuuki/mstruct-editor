export function createDesktopDocumentAdapter(desktopApi, getAnalysisName = () => "") {
  return {
    kind: "desktop",
    pianoOptions: { instrumentUrl: desktopApi.pianoInstrumentUrl },
    setDirty(dirty) {
      desktopApi.setDirty(dirty);
    },
    onCommand(callback) {
      desktopApi.onCommand(callback);
    },
    async requestNew() {
      const result = await desktopApi.newDocument();
      return !result.cancelled;
    },
    async requestOpen({ recentId, libraryPath } = {}) {
      if (libraryPath) return desktopApi.libraryOpen(libraryPath);
      return recentId ? desktopApi.openRecentDocument(recentId) : desktopApi.openDocument();
    },
    async acceptOpen(token) {
      return desktopApi.acceptOpenedDocument(token);
    },
    async save({ text, suggestedName, saveAs = false }) {
      const analysisName = getAnalysisName();
      return desktopApi.saveDocument({ text, suggestedName: analysisName ? `${analysisName}.mstruct` : suggestedName, saveAs, analysisName });
    },
  };
}
