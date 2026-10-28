export const TAG_CONFIG_HEADERS = ["token", "zh_name", "en_name", "duration_mode"];

export function parseTagCsvRows(csv) {
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
  if (quoted) throw new Error("Tag CSV contains an unclosed quoted cell.");
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function parseTagConfigCsv(csv) {
  const [header, ...body] = parseTagCsvRows(csv);
  if (!header || header.length !== TAG_CONFIG_HEADERS.length
    || header.some((cell, index) => cell !== TAG_CONFIG_HEADERS[index])) {
    throw new Error(`Tag CSV header must be: ${TAG_CONFIG_HEADERS.join(",")}`);
  }

  const tags = [];
  const byToken = new Map();
  body.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== TAG_CONFIG_HEADERS.length) {
      throw new Error(`Tag CSV row ${rowNumber} must contain exactly ${TAG_CONFIG_HEADERS.length} columns.`);
    }
    const token = row[0].trim();
    const zhName = row[1].trim();
    const enName = row[2].trim();
    const durationModeText = row[3].trim();
    const inner = token.slice(1, -1);
    if (!token.startsWith("<") || !token.endsWith(">") || !inner
      || /[<>\\\s]/.test(inner) || /[^\x00-\x7F]/.test(token) || /^(?:\/|\*\/)/.test(inner)) {
      throw new Error(`Tag token on CSV row ${rowNumber} must use a nonempty ASCII <token> form without spaces, backslashes or closing prefixes / and */.`);
    }
    if (!zhName || !enName) throw new Error(`Tag CSV row ${rowNumber} requires both Chinese and English names.`);
    if (!/^[123]$/.test(durationModeText)) throw new Error(`Duration mode on tag CSV row ${rowNumber} must be 1, 2, or 3.`);
    if (byToken.has(token)) throw new Error(`Tag token ${token} is duplicated.`);
    const definition = {
      token,
      closingToken: `</${inner}>`,
      zhName,
      enName,
      durationMode: Number(durationModeText),
    };
    tags.push(definition);
    byToken.set(token, definition);
  });
  return { tags, byToken };
}

export function tagDisplayName(definition, locale) {
  return locale === "en" ? definition.enName : definition.zhName;
}
