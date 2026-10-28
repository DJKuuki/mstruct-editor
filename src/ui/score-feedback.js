/** Empty editor documents render quietly; real syntax/profile errors remain visible. */
export function createScoreFeedback({ canvas, status, makeElement, tr, formatDiagnostic }) {
  return {
    renderBlank(source, result) {
      if (source.trim() || !result.errors.every(error => error.code === "empty-file")) return false;
      canvas.replaceChildren();
      status.className = "render-status";
      status.textContent = "";
      return true;
    },
    renderError(errors) {
      canvas.replaceChildren();
      const errorBox = makeElement("section", "render-error");
      errorBox.append(makeElement("p", "error-kicker", tr("syntaxErrorTitle")));
      errorBox.append(makeElement("h3", null, tr("renderFailed")));
      const list = makeElement("ol", "error-list");
      for (const error of errors) {
        const item = makeElement("li");
        if (Number.isInteger(error.line)) item.append(makeElement("span", "error-location", tr("line", { count: error.line })));
        item.append(canvas.ownerDocument.createTextNode(formatDiagnostic(error)));
        list.append(item);
      }
      errorBox.append(list);
      canvas.append(errorBox);
      status.className = "render-status is-error";
      status.textContent = tr("errors", { count: errors.length });
    },
  };
}
