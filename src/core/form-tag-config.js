import { parseTagConfigCsv, parseTagCsvRows } from "./tag-config.js";

export const FORM_TAG_HEADERS = ["token", "zh_name", "en_name", "duration_mode", "parent", "replace_previous", "allow_global"];

function readFormRows(csv) {
  const [header, ...rows] = parseTagCsvRows(csv);
  const legacy = header?.length === FORM_TAG_HEADERS.length - 1;
  const expected = legacy ? FORM_TAG_HEADERS.slice(0, -1) : FORM_TAG_HEADERS;
  if (!header || header.length !== expected.length || header.some((value, index) => value !== expected[index])) {
    throw new Error(`Form CSV header must be: ${FORM_TAG_HEADERS.join(",")}`);
  }
  for (const [index, row] of rows.entries()) {
    if (row.length !== expected.length) throw new Error(`Form CSV row ${index + 2} must contain ${expected.length} columns.`);
  }
  return { rows, legacy };
}

/** Upgrade an editable draft without rewriting an immutable historical CSV. */
export function formTagRowsForEditing(csv) {
  const { rows, legacy } = readFormRows(csv);
  return rows.map(row => legacy ? [...row, row[4].trim() ? "0" : "1"] : row);
}

/** Form identity, syntax and replacement policy come entirely from the bound CSV. */
export function parseFormTagConfigCsv(csv) {
  const { rows, legacy } = readFormRows(csv);
  const quote = (value) => `"${value.replaceAll('"', '""')}"`;
  const base = parseTagConfigCsv([FORM_TAG_HEADERS.slice(0, 4).join(","), ...rows.map((row) => row.slice(0, 4).map(quote).join(","))].join("\n"));
  for (const [index, tag] of base.tags.entries()) {
    const parent = rows[index][4].trim();
    const replacement = rows[index][5].trim();
    if (!/^[01]$/.test(replacement)) throw new Error(`Form CSV row ${index + 2}: replace_previous must be 0 or 1.`);
    if (parent && /[<>\\\s]|[^\x00-\x7F]/.test(parent)) throw new Error(`Form CSV row ${index + 2}: invalid parent.`);
    if (/^FORM_END(?::|$)/.test(tag.token.slice(1, -1))) throw new Error("FORM_END is reserved for form controls.");
    Object.assign(tag, { form: true, parent, group: parent || tag.token.slice(1, -1), replacePrevious: replacement === "1" });
    // Omit new semantic fields on historical six-column packages so their
    // compatibility hashes and replacement behavior remain reproducible.
    if (!legacy) {
      const allowGlobal = rows[index][6].trim();
      if (!/^[01]$/.test(allowGlobal)) throw new Error(`Form CSV row ${index + 2}: allow_global must be 0 or 1.`);
      tag.allowGlobal = allowGlobal === "1";
    }
  }
  for (const tag of base.tags) {
    if (tag.parent) {
      const parent = base.byToken.get(`<${tag.parent}>`);
      if (!parent || parent === tag || parent.parent) throw new Error(`Form ${tag.token} requires an existing independent parent.`);
    }
  }
  return base;
}
