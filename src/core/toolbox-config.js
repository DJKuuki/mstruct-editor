// Pure CSV data contract shared by the editor, profile publisher and hosts.
export const TOOLBOX_MENU_HEADERS = ["一级菜单id", "二级菜单id", "中文名", "英文名"];
export const TOOLBOX_EVENT_HEADERS = ["插入内容", "光标位置", "中文名", "英文名", "一级菜单id", "二级菜单id"];

export function parseToolboxCsvRows(csv) {
  const source = String(csv ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell === "") quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted cell.");
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function requireHeader(rows, expected, label) {
  const [header, ...body] = rows;
  if (!header || header.length !== expected.length || header.some((cell, index) => cell !== expected[index])) {
    throw new Error(`${label} CSV header must be: ${expected.join(",")}`);
  }
  return body;
}

function requireRowWidth(row, width, label, index) {
  if (row.length !== width) throw new Error(`${label} CSV row ${index + 2} must contain exactly ${width} columns.`);
}

function requireId(value, label, rowNumber) {
  const id = value.trim();
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`${label} on CSV row ${rowNumber} must be a positive integer.`);
  return id;
}

export function parseToolboxConfigCsv(value) {
  if (!value || typeof value !== "object") throw new Error("Toolbox configuration must contain both CSV tables.");
  const menuRows = requireHeader(parseToolboxCsvRows(value.menuCsv), TOOLBOX_MENU_HEADERS, "Toolbox menu");
  const eventRows = requireHeader(parseToolboxCsvRows(value.eventCsv), TOOLBOX_EVENT_HEADERS, "Toolbox event");
  const primaryMenus = [];
  const primaryById = new Map();
  const pendingSecondaryMenus = [];

  menuRows.forEach((row, index) => {
    requireRowWidth(row, TOOLBOX_MENU_HEADERS.length, "Toolbox menu", index);
    const primaryId = requireId(row[0], "Primary menu ID", index + 2);
    const secondaryId = row[1].trim();
    const zhName = row[2].trim();
    const enName = row[3].trim();
    if (!zhName || !enName) throw new Error(`Toolbox menu CSV row ${index + 2} requires both Chinese and English names.`);
    if (!secondaryId) {
      if (primaryById.has(primaryId)) throw new Error(`Primary menu ID ${primaryId} is duplicated.`);
      const menu = { id: primaryId, zhName, enName, secondaryMenus: [] };
      primaryMenus.push(menu);
      primaryById.set(primaryId, menu);
    } else {
      pendingSecondaryMenus.push({ primaryId, id: requireId(secondaryId, "Secondary menu ID", index + 2), zhName, enName, rowNumber: index + 2 });
    }
  });
  if (!primaryMenus.length) throw new Error("Toolbox menu CSV must define at least one primary menu.");

  const secondaryKeys = new Set();
  for (const secondary of pendingSecondaryMenus) {
    const primary = primaryById.get(secondary.primaryId);
    if (!primary) throw new Error(`Secondary menu on CSV row ${secondary.rowNumber} refers to missing primary menu ID ${secondary.primaryId}.`);
    const key = `${secondary.primaryId}\u0000${secondary.id}`;
    if (secondaryKeys.has(key)) throw new Error(`Secondary menu ID ${secondary.id} is duplicated under primary menu ${secondary.primaryId}.`);
    secondaryKeys.add(key);
    primary.secondaryMenus.push({ id: secondary.id, zhName: secondary.zhName, enName: secondary.enName });
  }

  const events = eventRows.map((row, index) => {
    requireRowWidth(row, TOOLBOX_EVENT_HEADERS.length, "Toolbox event", index);
    const insertion = row[0];
    const cursorText = row[1].trim();
    const zhName = row[2].trim();
    const enName = row[3].trim();
    const primaryId = requireId(row[4], "Primary menu ID", index + 2);
    const secondaryId = row[5].trim();
    if (!insertion) throw new Error(`Toolbox event CSV row ${index + 2} requires insertion content.`);
    if (!/^-?\d+$/.test(cursorText)) throw new Error(`Cursor position on toolbox event CSV row ${index + 2} must be an integer.`);
    const cursorPosition = Number(cursorText);
    const cursorOffset = cursorPosition >= 0 ? cursorPosition : insertion.length + cursorPosition + 1;
    if (!Number.isSafeInteger(cursorPosition) || cursorOffset < 0 || cursorOffset > insertion.length) {
      throw new Error(`Cursor position on toolbox event CSV row ${index + 2} falls outside the inserted content.`);
    }
    if (!zhName || !enName) throw new Error(`Toolbox event CSV row ${index + 2} requires both Chinese and English names.`);
    if (!primaryById.has(primaryId)) throw new Error(`Toolbox event CSV row ${index + 2} refers to missing primary menu ID ${primaryId}.`);
    let normalizedSecondaryId = "";
    if (secondaryId) {
      normalizedSecondaryId = requireId(secondaryId, "Secondary menu ID", index + 2);
      if (!secondaryKeys.has(`${primaryId}\u0000${normalizedSecondaryId}`)) {
        throw new Error(`Toolbox event CSV row ${index + 2} refers to missing secondary menu ID ${normalizedSecondaryId} under primary menu ${primaryId}.`);
      }
    }
    return { insertion, cursorPosition, cursorOffset, zhName, enName, primaryId, secondaryId: normalizedSecondaryId };
  });

  return { primaryMenus, events };
}
