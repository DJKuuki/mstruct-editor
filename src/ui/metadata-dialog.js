import { isAsciiRomanized, isSongLength, MAX_COMPOSERS, MAX_VOCALISTS, normalizeMetadata } from "../core/mstruct-document.js";
import { tr } from "../editor-i18n.js";
import { createMetadataLinksEditor } from "./metadata-links.js";

export function createMetadataDialog({ makeElement, getMetadata, isMetadataLocked, isLockedMetadataField, metadataFields, metadataDialog, metadataForm, notifyDirtyState, parseMainSource, validateGlobalTags, sourceInput }) {
  let draft = null;
  let metadataControlId = 0;
  let linksEditor;

  function normalizeMetadataDraft(value, preserveEmptyVocalists = false) {
    const normalized = normalizeMetadata(value);
    if (preserveEmptyVocalists && Array.isArray(value?.originalVocalists)) {
      normalized.originalVocalists = value.originalVocalists.slice(0, MAX_VOCALISTS).map((vocalist) => ({
        name: String(vocalist?.name ?? ""),
        romanized: String(vocalist?.romanized ?? ""),
      }));
    }
    return normalized;
  }

  function createMetadataSection(title, description = "") {
    const section = makeElement("fieldset", "metadata-section");
    section.append(makeElement("legend", null, title));
    if (description) section.append(makeElement("p", "metadata-section-note", description));
    return section;
  }

  function appendMetadataControl(parent, {
    label,
    name,
    value = "",
    type = "text",
    placeholder = "",
    inputMode = "",
    multiline = false,
    asciiOnly = false,
    disabled = false,
    disabledTitle = "",
  }) {
    const field = makeElement("label", "metadata-field");
    const identifier = `metadata-${name}-${metadataControlId += 1}`;
    field.htmlFor = identifier;
    const labelElement = makeElement("span", "metadata-field-label", label);
    field.append(labelElement);
    const control = document.createElement(multiline ? "textarea" : "input");
    control.id = identifier;
    control.name = name;
    if (type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
    control.placeholder = placeholder;
    if (!multiline) control.type = type;
    if (inputMode) control.inputMode = inputMode;
    if (multiline) control.rows = 5;
    const locked = isLockedMetadataField(name);
    if (locked || disabled) {
      control.disabled = true;
      control.title = locked ? tr("locked") : disabledTitle;
      field.title = control.title;
      field.classList.add("is-disabled");
    }
    if (asciiOnly) {
      control.dataset.romanizedField = "true";
      control.addEventListener("input", () => validateRomanizedControl(control));
      validateRomanizedControl(control);
    }
    if (type === "checkbox") field.classList.add("metadata-checkbox-field");
    field.append(control);
    parent.append(field);
    return control;
  }

  function appendNamePair(parent, {
    label,
    name,
    romanizedName,
    value = "",
    romanizedValue = "",
  }) {
    const row = makeElement("div", "metadata-pair");
    appendMetadataControl(row, { label, name, value });
    appendMetadataControl(row, {
      label: `${label}${tr("romanized")}`,
      name: romanizedName,
      value: romanizedValue,
      asciiOnly: true,
    });
    parent.append(row);
  }

  function validateRomanizedControl(control) {
    const valid = isAsciiRomanized(control.value);
    control.setCustomValidity(valid ? "" : tr("romanizedAscii"));
    control.classList.toggle("is-invalid", !valid);
    return valid;
  }

  function addRepeatingHeader(parent, title, buttonLabel, disabled, onAdd) {
    const header = makeElement("div", "metadata-repeat-header");
    header.append(makeElement("p", null, title));
    const button = makeElement("button", "metadata-add", buttonLabel);
    button.type = "button";
    button.disabled = disabled;
    button.addEventListener("click", onAdd);
    header.append(button);
    parent.append(header);
  }

  function addRemoveButton(parent, label, onRemove) {
    const button = makeElement("button", "metadata-remove", label);
    button.type = "button";
    button.addEventListener("click", onRemove);
    parent.append(button);
  }

  function currentMetadataFromForm() {
    const value = (name) => metadataForm.elements.namedItem(name)?.value ?? "";
    const checked = (name) => Boolean(metadataForm.elements.namedItem(name)?.checked);
    const previous = normalizeMetadata(draft ?? getMetadata());
    const composers = [...metadataFields.querySelectorAll("[data-composer-row]")].map((row) => ({
      name: row.querySelector('[name="composerName"]')?.value ?? "",
      romanized: row.querySelector('[name="composerRomanized"]')?.value ?? "",
      alias: row.querySelector('[name="composerAlias"]')?.value ?? "",
      id: row.querySelector('[name="composerId"]')?.value ?? "",
    }));
    const originalVocalists = [...metadataFields.querySelectorAll("[data-original-vocalist-row]")].map((row) => ({
      name: row.querySelector('[name="originalVocalistName"]')?.value ?? "",
      romanized: row.querySelector('[name="originalVocalistRomanized"]')?.value ?? "",
    }));

    const normalized = normalizeMetadata({
      ...previous,
      creator: value("creator") || previous.creator,
      editors: value("editors") || previous.editors,
      reposted: checked("reposted"),
      originalAnalyzer: value("originalAnalyzer") || previous.originalAnalyzer,
      originalAnalyzerRomanized: value("originalAnalyzerRomanized") || previous.originalAnalyzerRomanized,
      originalEditor: value("originalEditor") || previous.originalEditor,
      coEditors: value("coEditors") || previous.coEditors,
      versionName: value("versionName"),
      songName: value("songName"),
      songNameRomanized: value("songNameRomanized"),
      composers,
      originalVocalists,
      albumName: value("albumName"),
      albumNameRomanized: value("albumNameRomanized"),
      groupName: value("groupName"),
      groupNameRomanized: value("groupNameRomanized"),
      sourceName: value("sourceName"),
      sourceNameRomanized: value("sourceNameRomanized"),
      tags: value("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      globalTags: value("globalTags"),
      songLength: value("songLength"),
      isStableTempo: checked("isStableTempo"),
      offset: metadataForm.elements.namedItem("offset") ? value("offset") : previous.offset,
      mstructtimeFiles: previous.mstructtimeFiles,
      ...linksEditor.read(),
      comments: value("comments"),
      extraFields: (draft ?? getMetadata()).extraFields,
    });
    normalized.originalVocalists = originalVocalists.slice(0, MAX_VOCALISTS);
    return normalized;
  }

  function renderMetadataFields() {
    const data = normalizeMetadataDraft(draft ?? getMetadata(), Boolean(draft));
    metadataControlId = 0;
    metadataFields.replaceChildren();

    const workSection = createMetadataSection(tr("basic"));
    const repostedControl = appendMetadataControl(workSection, { label: tr("reposted"), name: "reposted", value: data.reposted, type: "checkbox" });
    repostedControl.addEventListener("change", () => { draft = currentMetadataFromForm(); renderMetadataFields(); });
    if (data.reposted) {
      appendNamePair(workSection, { label: tr("originalAnalyzer"), name: "originalAnalyzer", romanizedName: "originalAnalyzerRomanized", value: data.originalAnalyzer, romanizedValue: data.originalAnalyzerRomanized });
      appendMetadataControl(workSection, { label: tr("originalEditor"), name: "originalEditor", value: data.originalEditor || data.creator });
      appendMetadataControl(workSection, { label: tr("coEditors"), name: "coEditors", value: data.coEditors.join(", ") });
    } else {
      appendMetadataControl(workSection, { label: tr("creator"), name: "creator", value: data.creator, placeholder: tr("accountName") });
      appendMetadataControl(workSection, { label: tr("editors"), name: "editors", value: data.editors.join(", ") });
    }
    appendMetadataControl(workSection, { label: tr("versionName"), name: "versionName", value: data.versionName, placeholder: tr("versionNamePlaceholder") });
    appendNamePair(workSection, {
      label: tr("songName"),
      name: "songName",
      romanizedName: "songNameRomanized",
      value: data.songName,
      romanizedValue: data.songNameRomanized,
    });
    metadataFields.append(workSection);

    const composerSection = createMetadataSection(tr("composers"), tr("composersNote", { count: MAX_COMPOSERS }));
    addRepeatingHeader(composerSection, tr("composerList"), tr("addComposer"), isMetadataLocked() || data.composers.length >= MAX_COMPOSERS, () => {
      draft = currentMetadataFromForm();
      if (draft.composers.length < MAX_COMPOSERS) draft.composers.push({ name: "", romanized: "" });
      renderMetadataFields();
    });
    data.composers.forEach((composer, index) => {
      const row = makeElement("div", "metadata-repeat-row");
      row.dataset.composerRow = "true";
      const rowTitle = makeElement("p", "metadata-repeat-title", tr("composer", { count: index + 1 }));
      row.append(rowTitle);
      appendNamePair(row, {
        label: tr("name"),
        name: "composerName",
        romanizedName: "composerRomanized",
        value: composer.name,
        romanizedValue: composer.romanized,
      });
      appendMetadataControl(row, { label: tr("alias"), name: "composerAlias", value: composer.alias });
      appendMetadataControl(row, { label: tr("composerId"), name: "composerId", value: composer.id });
      if (index > 0 && !isMetadataLocked()) addRemoveButton(row, tr("remove"), () => {
        draft = currentMetadataFromForm();
        draft.composers.splice(index, 1);
        renderMetadataFields();
      });
      composerSection.append(row);
    });
    const vocalistSection = createMetadataSection(tr("originalVocalistList"), tr("vocalistsNote", { count: MAX_VOCALISTS }));
    addRepeatingHeader(vocalistSection, tr("originalVocalistList"), tr("addVocalist"), isMetadataLocked() || data.originalVocalists.length >= MAX_VOCALISTS, () => {
      draft = currentMetadataFromForm();
      if (draft.originalVocalists.length < MAX_VOCALISTS) draft.originalVocalists.push({ name: "", romanized: "" });
      renderMetadataFields();
    });
    data.originalVocalists.forEach((vocalist, index) => {
      const row = makeElement("div", "metadata-repeat-row");
      row.dataset.originalVocalistRow = "true";
      appendNamePair(row, {
        label: tr("originalVocalist", { count: index + 1 }),
        name: "originalVocalistName",
        romanizedName: "originalVocalistRomanized",
        value: vocalist.name,
        romanizedValue: vocalist.romanized,
      });
      if (!isMetadataLocked()) addRemoveButton(row, tr("remove"), () => {
        draft = currentMetadataFromForm();
        draft.originalVocalists.splice(index, 1);
        renderMetadataFields();
      });
      vocalistSection.append(row);
    });
    metadataFields.append(vocalistSection);
    metadataFields.append(composerSection);

    const identitySection = createMetadataSection(tr("release"));
    appendNamePair(identitySection, { label: tr("album"), name: "albumName", romanizedName: "albumNameRomanized", value: data.albumName, romanizedValue: data.albumNameRomanized });
    appendNamePair(identitySection, { label: tr("group"), name: "groupName", romanizedName: "groupNameRomanized", value: data.groupName, romanizedValue: data.groupNameRomanized });
    appendNamePair(identitySection, { label: tr("source"), name: "sourceName", romanizedName: "sourceNameRomanized", value: data.sourceName, romanizedValue: data.sourceNameRomanized });
    metadataFields.append(identitySection);

    const tagSection = createMetadataSection(tr("tags"), tr("tagsHint"));
    appendMetadataControl(tagSection, { label: tr("tags"), name: "tags", value: data.tags.join(",") });
    appendMetadataControl(tagSection, { label: tr("globalTags"), name: "globalTags", value: data.globalTags, placeholder: tr("globalTagsPlaceholder") });
    tagSection.append(makeElement("p", "metadata-section-note", tr("globalTagsHint")));
    metadataFields.append(tagSection);

    const linkSection = createMetadataSection(tr("durationLinks"), tr("durationNote"));
    const timelineOwnsDuration = !data.isStableTempo;
    appendMetadataControl(linkSection, {
      label: tr("songLength"),
      name: "songLength",
      value: data.songLength,
      placeholder: "4:30",
      inputMode: "numeric",
      disabled: timelineOwnsDuration,
      disabledTitle: tr("timelineMetadataOwned"),
    });
    const stableTempoControl = appendMetadataControl(linkSection, { label: tr("stableTempo"), name: "isStableTempo", value: data.isStableTempo, type: "checkbox" });
    stableTempoControl.closest("label")?.append(makeElement("span", "metadata-checkbox-hint", tr("stableTempoHint")));
    stableTempoControl.addEventListener("change", () => {
      draft = currentMetadataFromForm();
      renderMetadataFields();
    });
    const offsetControl = appendMetadataControl(linkSection, {
      label: tr("offsetMilliseconds"),
      name: "offset",
      value: data.offset,
      placeholder: "0",
      inputMode: "numeric",
    });
    offsetControl.closest("label")?.append(makeElement("span", "metadata-checkbox-hint", tr("offsetStableOnly")));
    const links = makeElement("div"); linkSection.append(links);
    linksEditor = createMetadataLinksEditor({ parent: links, metadata: data, tr, onChange: () => { applyMetadataFormValidity(); notifyDirtyState(); } });
    metadataFields.append(linkSection);

    const notesSection = createMetadataSection(tr("notes"), tr("notesDescription"));
    appendMetadataControl(notesSection, { label: tr("comments"), name: "comments", value: data.comments, multiline: true, placeholder: tr("commentsPlaceholder") });
    metadataFields.append(notesSection);

    const systemSection = createMetadataSection(tr("systemMetadata"));
    for (const [name, label, value] of [
      ["mstructFormatVersion", "mstructFormatVersion", data.mstructFormatVersion],
      ["profileVersion", "profileVersion", data.mstructProfileId.split("/").at(-1)],
      ["mstructProfileId", "profileId", data.mstructProfileId],
      ["mstructProfileHash", "profileHash", data.mstructProfileHash],
    ]) {
      appendMetadataControl(systemSection, { label: tr(label), name, value, disabled: true, disabledTitle: tr("locked") });
    }
    metadataFields.append(systemSection);

    metadataFields.querySelectorAll("input, textarea").forEach((control) => {
      control.addEventListener("input", () => { applyMetadataFormValidity(); notifyDirtyState(); });
      control.addEventListener("change", () => { applyMetadataFormValidity(); notifyDirtyState(); });
    });
    applyMetadataFormValidity();
    if (metadataDialog.open) notifyDirtyState();
  }

  function applyMetadataFormValidity() {
    const songLength = metadataForm.elements.namedItem("songLength");
    songLength.setCustomValidity(songLength.disabled || isSongLength(songLength.value.trim()) ? "" : tr("invalidLength"));
    const tags = metadataForm.elements.namedItem("tags");
    tags.setCustomValidity(tags.value.split(",").map((tag) => tag.trim()).filter(Boolean).length <= 20 ? "" : tr("tagLimit"));
    const globalTags = metadataForm.elements.namedItem("globalTags");
    if (globalTags) globalTags.setCustomValidity(validateGlobalTags(globalTags.value));
    const offset = metadataForm.elements.namedItem("offset");
    if (offset) offset.setCustomValidity(offset.disabled || /^-?\d+$/.test(offset.value.trim()) ? "" : tr("offsetInteger"));
    linksEditor.validate();
    for (const control of metadataFields.querySelectorAll("[data-romanized-field]")) {
      validateRomanizedControl(control);
    }
    const stableTempo = metadataForm.elements.namedItem("isStableTempo");
    if (stableTempo) {
      const candidate = currentMetadataFromForm();
      const scoreResult = parseMainSource(sourceInput.value, candidate);
      const uncovered = scoreResult.errors.some((error) => error.code === "missing-stable-tempo");
      const requiresStableTempo = scoreResult.errors.some((error) => error.code === "repeat-continuous-bars-stable-only");
      const hasTimelines = candidate.mstructtimeFiles.length > 0;
      stableTempo.setCustomValidity(
        stableTempo.checked && hasTimelines
          ? tr("stableTempoHasTimelines")
          : uncovered
            ? tr("stableTempoNeedsBpm")
            : requiresStableTempo
              ? tr("continuousRepeatNeedsStableTempo")
              : "",
      );
    }
  }

  function validateMetadataForm() {
    applyMetadataFormValidity();
    return metadataForm.reportValidity();
  }

  function openMetadataDialog() {
    draft = normalizeMetadata(getMetadata());
    renderMetadataFields();
    metadataDialog.showModal();
    metadataDialog.querySelector("input, textarea")?.focus();
  }

  return { currentMetadataFromForm, openMetadataDialog, validateMetadataForm, resetMetadataDraft: () => { draft = null; } };
}
