import { MAX_SCORE_URLS, MAX_ADDITIONAL_URLS, STANDARD_LINK_FIELDS, normalizeMetadataLinks } from "../core/metadata-links.js";

/** Shared controls keep both metadata dialogs' add/remove/read/validation behavior identical. */
export function createMetadataLinksEditor({ parent, metadata, tr, onChange = () => {} }) {
  const initial = normalizeMetadataLinks(metadata);
  const node = (tag, className, text = "") => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  };
  const field = (row, name, caption, value, url = false) => {
    const label = node("label", "metadata-field");
    label.append(node("span", "metadata-field-label", caption));
    const input = node("input"); input.name = name; input.value = value; input.type = url ? "url" : "text";
    if (url) input.placeholder = "https://";
    label.append(input); row.append(label); return input;
  };
  const repeating = (title, addLabel, maximum, values, makeRow) => {
    const section = node("div"), header = node("div", "metadata-repeat-header"), rows = node("div");
    const add = node("button", "metadata-add", tr(addLabel)); add.type = "button";
    header.append(node("p", null, tr(title)), add); section.append(header, rows); parent.append(section);
    function update() {
      add.disabled = rows.children.length >= maximum;
      [...rows.children].forEach((row, index) => {
        row.querySelectorAll("[data-caption]").forEach(caption => { caption.textContent = tr(caption.dataset.caption, { count: index + 1 }); });
        row.querySelector("button").hidden = index === 0;
      });
      validate(); onChange();
    }
    function append(value) {
      const row = node("div", "metadata-url-row");
      makeRow(row, value);
      const remove = node("button", "metadata-remove", tr("remove")); remove.type = "button";
      remove.addEventListener("click", () => { row.remove(); update(); }); row.append(remove); rows.append(row);
    }
    values.forEach(append);
    add.disabled = rows.children.length >= maximum;
    [...rows.children].forEach((row, index) => { row.querySelector("button").hidden = index === 0; });
    add.addEventListener("click", () => { append(title === "scoreLinks" ? "" : { label: "", url: "" }); update(); });
    return rows;
  };
  const numberedField = (row, name, key, value, url = false) => {
    const input = field(row, name, tr(key, { count: 1 }), value, url);
    input.previousElementSibling.dataset.caption = key; return input;
  };
  const scores = repeating("scoreLinks", "addScoreLink", MAX_SCORE_URLS, initial.scoreUrls, (row, value) => {
    numberedField(row, "scoreUrl", "scoreLink", value, true);
  });
  const standard = node("div", "metadata-pair"); parent.append(standard);
  for (const [key] of STANDARD_LINK_FIELDS) field(standard, `link-${key}`, tr(key), initial.links[key], true);
  const additional = repeating("extraLinks", "addExtraLink", MAX_ADDITIONAL_URLS, initial.additionalUrls, (row, value) => {
    row.className = "metadata-repeat-row metadata-additional-row";
    numberedField(row, "additionalLabel", "websiteName", value.label);
    numberedField(row, "additionalUrl", "websiteLink", value.url, true);
  });
  // Initial labels are numbered after the complete row set has been mounted.
  for (const rows of [scores, additional]) [...rows.children].forEach((row, index) => {
    row.querySelectorAll("[data-caption]").forEach(caption => { caption.textContent = tr(caption.dataset.caption, { count: index + 1 }); });
  });
  function read() {
    return {
      scoreUrls: [...scores.querySelectorAll("input")].map(input => input.value),
      links: Object.fromEntries(STANDARD_LINK_FIELDS.map(([key]) => [key, standard.querySelector(`[name="link-${key}"]`).value])),
      additionalUrls: [...additional.children].map(row => ({ label: row.querySelector('[name="additionalLabel"]').value, url: row.querySelector('[name="additionalUrl"]').value })),
    };
  }
  function validate() {
    for (const row of additional.children) {
      const label = row.querySelector('[name="additionalLabel"]'), url = row.querySelector('[name="additionalUrl"]');
      url.setCustomValidity(Boolean(label.value.trim()) === Boolean(url.value.trim()) ? "" : tr("pairedLinks"));
    }
  }
  parent.addEventListener("input", () => { validate(); onChange(); });
  return { read, validate };
}
