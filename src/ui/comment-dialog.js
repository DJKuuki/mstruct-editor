import { COMMENT_LANGUAGES, normalizeComments } from "../core/mstruct-comments.js";

export function createCommentDialog({
  dialog,
  list,
  status,
  addButton,
  editButton,
  deleteButton,
  confirmButton,
  cancelButton,
  closeButton,
  textDialog,
  textForm,
  textClose,
  textCancel,
  languageSelect,
  textArea,
  getComments,
  getLocale,
  onSave,
  notifyDirtyState,
  tr,
}) {
  let draft = null;
  let selectedNumber = null;
  let editorDraft = null;
  let editingLanguage = "zh_cn";

  function selectedComment() {
    return draft?.find((comment) => comment.number === selectedNumber) ?? null;
  }

  function currentDraftComments() {
    const current = normalizeComments(draft ?? getComments()).map((comment) => ({
      number: comment.number,
      texts: { ...comment.texts },
    }));
    if (!editorDraft || selectedNumber === null) return current;
    const selected = current.find((comment) => comment.number === selectedNumber);
    if (selected) {
      selected.texts = { ...editorDraft };
      selected.texts[editingLanguage] = textArea.value.replace(/\r\n?/g, "\n");
    }
    return normalizeComments(current);
  }

  function reflectButtons() {
    const selected = Boolean(selectedComment());
    editButton.disabled = !selected;
    deleteButton.disabled = !selected;
  }

  function renderList() {
    list.replaceChildren();
    if (!draft?.length) {
      const empty = document.createElement("p");
      empty.className = "comment-list-empty";
      empty.textContent = tr("commentEmpty");
      list.append(empty);
    }
    for (const comment of draft ?? []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "comment-list-item";
      button.dataset.selected = String(comment.number === selectedNumber);
      button.setAttribute("aria-pressed", String(comment.number === selectedNumber));
      const name = document.createElement("strong");
      name.textContent = tr("commentNumber", { count: comment.number });
      const languages = document.createElement("span");
      languages.textContent = COMMENT_LANGUAGES.filter((language) => comment.texts[language]).map((language) => language === "zh_cn" ? "简体中文" : "English").join(" · ") || "—";
      button.append(name, languages);
      button.addEventListener("click", () => {
        selectedNumber = comment.number;
        status.textContent = "";
        renderList();
      });
      list.append(button);
    }
    reflectButtons();
    notifyDirtyState();
  }

  function openDialog() {
    draft = normalizeComments(getComments()).map((comment) => ({
      number: comment.number,
      texts: { ...comment.texts },
    }));
    selectedNumber = draft[0]?.number ?? null;
    status.textContent = "";
    renderList();
    dialog.showModal();
  }

  function closeWithoutSaving() {
    draft = null;
    selectedNumber = null;
    status.textContent = "";
    if (dialog.open) dialog.close();
    notifyDirtyState();
  }

  function openTextEditor() {
    const comment = selectedComment();
    if (!comment) {
      status.textContent = tr("selectComment");
      return;
    }
    editorDraft = { ...comment.texts };
    editingLanguage = getLocale() === "en" ? "en" : "zh_cn";
    languageSelect.value = editingLanguage;
    textArea.value = editorDraft[editingLanguage] ?? "";
    textArea.setCustomValidity("");
    textDialog.showModal();
    textArea.focus();
  }

  function closeTextEditor() {
    editorDraft = null;
    if (textDialog.open) textDialog.close();
    notifyDirtyState();
  }

  addButton.addEventListener("click", () => {
    const number = Math.max(0, ...(draft ?? []).map((comment) => comment.number)) + 1;
    draft.push({ number, texts: { zh_cn: "", en: "" } });
    selectedNumber = number;
    status.textContent = "";
    renderList();
  });
  editButton.addEventListener("click", openTextEditor);
  deleteButton.addEventListener("click", () => {
    if (!selectedComment()) return;
    draft = draft.filter((comment) => comment.number !== selectedNumber);
    selectedNumber = draft[0]?.number ?? null;
    renderList();
  });
  confirmButton.addEventListener("click", () => {
    onSave(normalizeComments(draft));
    draft = null;
    dialog.close();
  });
  cancelButton.addEventListener("click", closeWithoutSaving);
  closeButton.addEventListener("click", closeWithoutSaving);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeWithoutSaving(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeWithoutSaving(); });

  languageSelect.addEventListener("change", () => {
    if (!editorDraft) return;
    editorDraft[editingLanguage] = textArea.value;
    editingLanguage = languageSelect.value;
    textArea.value = editorDraft[editingLanguage] ?? "";
    textArea.setCustomValidity("");
    notifyDirtyState();
  });
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const invalid = /\[\/COMMENT:\d+<(?:zh_cn|en)>\]/i.test(textArea.value);
    textArea.setCustomValidity(invalid ? tr("commentBodySyntax") : "");
    if (!textForm.reportValidity() || !editorDraft) return;
    editorDraft[editingLanguage] = textArea.value.replace(/\r\n?/g, "\n");
    const comment = selectedComment();
    if (comment) comment.texts = { ...editorDraft };
    closeTextEditor();
    renderList();
  });
  textArea.addEventListener("input", () => { textArea.setCustomValidity(""); notifyDirtyState(); });
  textCancel.addEventListener("click", closeTextEditor);
  textClose.addEventListener("click", closeTextEditor);
  textDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeTextEditor(); });

  return {
    openCommentDialog: openDialog,
    currentComments: currentDraftComments,
    resetCommentDraft: () => { draft = null; selectedNumber = null; editorDraft = null; },
  };
}
