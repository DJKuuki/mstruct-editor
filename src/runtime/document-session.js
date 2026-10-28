export function setupDocumentSession({
  adapter,
  newButton,
  importButton,
  exportButton,
  importInput,
  isDirty,
  resetDocument,
  loadDocument,
  serializeDocument,
  captureSaveState,
  suggestedName,
  markSaved,
  markSavedAfterIo = true,
  afterNew,
  afterIo,
  afterOpen,
  afterSave,
  setStatus,
  tr,
  canSave = () => true,
}) {
  async function createNewDocument() {
    try {
      const accepted = await adapter.requestNew({ dirty: isDirty(), confirmMessage: tr("newDocumentConfirm") });
      if (accepted) {
        await resetDocument();
        await afterNew?.();
      }
    } catch {
      setStatus(tr("newFileFailed"), false);
    }
  }

  async function openDocument(recentId, libraryPath) {
    if (adapter.kind === "dev-browser") {
      adapter.requestOpen();
      return;
    }
    try {
      const opened = await adapter.requestOpen({ recentId: typeof recentId === "string" ? recentId : undefined, libraryPath });
      if (opened.cancelled) return false;
      const loaded = await loadDocument(opened.text, opened.name);
      if (!loaded.loaded) return;
      const accepted = await adapter.acceptOpen(opened.token);
      await afterIo?.(accepted);
      await afterOpen?.(accepted);
      if (markSavedAfterIo && !loaded.changed) markSaved();
      if (loaded.scoreOk) setStatus(tr("opened", { name: accepted.name }), true);
      return true;
    } catch {
      setStatus(tr("openFileFailed"), false);
    }
  }

  async function importSelectedFile(file) {
    if (!file) return;
    try {
      const imported = await adapter.readImport(file);
      const result = await loadDocument(imported.text, imported.name);
      if (result.loaded && markSavedAfterIo && !result.changed) markSaved();
    } catch {
      setStatus(tr("fileReadFailed"), false);
    }
  }

  async function saveDocument(saveAs = false) {
    if (!canSave()) { setStatus(tr("profileReadOnlySave"), false); return false; }
    try {
      const savedState = captureSaveState?.();
      const result = await adapter.save({
        text: serializeDocument(),
        suggestedName: suggestedName(),
        saveAs,
      });
      if (result.cancelled) return false;
      await afterIo?.(result);
      await afterSave?.(result, { saveAs });
      if (markSavedAfterIo) markSaved(savedState);
      setStatus(result.exported ? tr("exported") : tr("saved", { name: result.name }), true);
      return !isDirty();
    } catch {
      setStatus(adapter.kind === "desktop" ? tr("saveFileFailed") : tr("actionFailed"), false);
      return false;
    }
  }

  function handleCommand(command) {
    if (command === "new") void createNewDocument();
    if (command === "open") void openDocument();
    if (typeof command === "string" && command.startsWith("open-recent:")) void openDocument(command.slice("open-recent:".length));
    if (command === "save") void saveDocument();
    if (command === "save-as") void saveDocument(true);
  }

  function handleImportChange() {
    const [file] = importInput.files ?? [];
    void importSelectedFile(file).finally(() => { importInput.value = ""; });
  }

  function handleSaveClick() {
    void saveDocument();
  }

  newButton.addEventListener("click", createNewDocument);
  importButton.addEventListener("click", openDocument);
  exportButton.addEventListener("click", handleSaveClick);
  importInput.addEventListener("change", handleImportChange);
  adapter.onCommand(handleCommand);

  return {
    openLibrary: (path) => openDocument(undefined, path),
    save: saveDocument,
    destroy() {
      newButton.removeEventListener("click", createNewDocument);
      importButton.removeEventListener("click", openDocument);
      exportButton.removeEventListener("click", handleSaveClick);
      importInput.removeEventListener("change", handleImportChange);
    },
  };
}
