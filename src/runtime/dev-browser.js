import { webPianoOptions } from "./web-audio.js";

export function createDevBrowserDocumentAdapter({ importInput }) {
  return {
    kind: "dev-browser",
    pianoOptions: webPianoOptions(new URL("./", globalThis.location.href)),
    setDirty() {},
    onCommand() {},
    async requestNew({ dirty, confirmMessage }) {
      return !dirty || window.confirm(confirmMessage);
    },
    requestOpen() {
      importInput.click();
    },
    async readImport(file) {
      return { text: await file.text(), name: file.name };
    },
    async save({ text, suggestedName }) {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = suggestedName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      return { cancelled: false, name: suggestedName, exported: true };
    },
  };
}
