const NATURAL_DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL_OFFSETS = { "": 0, b: -1, bb: -2, "#": 1, x: 2 };
const OFFSET_ACCIDENTALS = new Map([[0, ""], [-1, "b"], [-2, "bb"], [1, "#"], [2, "x"]]);
const STRUCTURE_ACCIDENTALS = new Set(["", "b", "bb", "#", "x"]);
const FIGURE_ACCIDENTALS = new Set(["", "n", "b", "bb", "#", "x"]);
const TONAL_MODES = new Set(["", "M", "m"]);
const BASIC_QUALITIES = new Set(["M", "m", "D"]);
const ADVANCED_THIRD_QUALITIES = {
  "+": ["M", "D"], DM: ["M", "D"],
  o: ["m"], ho: ["m"], oM: ["m"], M: ["M", "m", "D"],
};
const SPECIAL_NOTE_NAME_MODES = new Set(["", "aug6", "aug6dim3"]);
const BASIC_TOKEN_PATTERN = /^(?:bb|b|#|x|n)?(?:I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii)$/;

export function isRomanBasicToken(value) { return BASIC_TOKEN_PATTERN.test(value); }

export class RomanSyntaxError extends Error {
  constructor(code, start, end, details = {}, message = code) {
    super(message);
    this.name = "RomanSyntaxError";
    this.code = code;
    this.start = Math.max(0, start);
    this.end = Math.max(this.start + 1, end);
    this.details = details;
  }
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function degreeText(item) {
  return `${item.accidental}${item.degree}`;
}

function cloneDegree(item) {
  return { accidental: item.accidental, degree: item.degree };
}

function parseDegreeToken(token, options = {}) {
  const value = String(token ?? "").trim();
  const match = /^(bb|b|#|x|n)?([1-9]\d*)$/.exec(value);
  const allowedAccidentals = options.allowNatural ? FIGURE_ACCIDENTALS : STRUCTURE_ACCIDENTALS;
  if (!match || !allowedAccidentals.has(match?.[1] ?? "")) {
    throw new RomanSyntaxError("invalid-degree", options.start ?? 0, options.end ?? Math.max(1, value.length), { token: value }, `Invalid Roman degree ${value}.`);
  }
  const degree = Number(match[2]);
  if (options.maxDegree && degree > options.maxDegree) {
    throw new RomanSyntaxError("degree-range", options.start ?? 0, options.end ?? Math.max(1, value.length), { token: value, max: options.maxDegree }, `Roman degree ${value} is out of range.`);
  }
  return { accidental: match[1] === "n" ? "" : (match[1] ?? ""), degree };
}

function naturalSemitones(degree) {
  const zeroBased = degree - 1;
  return Math.floor(zeroBased / 7) * 12 + NATURAL_DEGREE_SEMITONES[modulo(zeroBased, 7)];
}

function degreeSemitones(item) {
  return naturalSemitones(item.degree) + ACCIDENTAL_OFFSETS[item.accidental];
}

export function parseRomanBasicReference(input, options = {}) {
  const source = String(input ?? "");
  if (!options.config) throw new TypeError("parseRomanBasicReference requires a Roman config.");
  const entry = options.config.basics.get(source);
  if (!entry) {
    throw new RomanSyntaxError("base-not-found", 0, Math.max(1, source.length), { token: source }, "Unknown Roman base quality.");
  }
  const tonalMode = options.tonalMode === "m" ? "m" : "M";
  if (entry.tonalMode && entry.tonalMode !== tonalMode) {
    throw new RomanSyntaxError(
      "tonal-mode",
      0,
      Math.max(1, source.length),
      { token: entry.roman, required: entry.tonalMode, actual: tonalMode },
      `Roman numeral ${entry.roman} is not available in this tonal mode.`,
    );
  }
  const degree = parseDegreeToken(entry.degree, { maxDegree: 7 });
  return { ...entry, pitchOffset: modulo(degreeSemitones(degree), 12) };
}

function spellDegree(preferredDegree, semitones) {
  const normalizedPreferred = modulo(preferredDegree - 1, 7) + 1;
  const pitchClass = modulo(semitones, 12);
  const candidates = [];
  for (let shift = -2; shift <= 2; shift += 1) {
    const degree = modulo(normalizedPreferred - 1 + shift, 7) + 1;
    let offset = modulo(pitchClass - NATURAL_DEGREE_SEMITONES[degree - 1], 12);
    if (offset > 6) offset -= 12;
    if (!OFFSET_ACCIDENTALS.has(offset)) continue;
    candidates.push({
      accidental: OFFSET_ACCIDENTALS.get(offset),
      degree,
      score: Math.abs(shift) * 100 + Math.abs(offset) * 10,
    });
  }
  candidates.sort((left, right) => left.score - right.score || left.degree - right.degree);
  if (!candidates.length) throw new RomanSyntaxError("degree-spelling", 0, 1, {}, "Unable to spell the transformed Roman degree.");
  return { accidental: candidates[0].accidental, degree: candidates[0].degree };
}

function combineDegrees(root, relative) {
  return spellDegree(root.degree + relative.degree - 1, degreeSemitones(root) + degreeSemitones(relative));
}

export class RomanStructure {
  constructor(degrees = ["1"], rootDegree = null) {
    this.items = degrees.map((item) => typeof item === "string" ? parseDegreeToken(item) : cloneDegree(item));
    this.rootDegree = rootDegree
      ? (typeof rootDegree === "string" ? parseDegreeToken(rootDegree) : cloneDegree(rootDegree))
      : cloneDegree(this.items[0] ?? parseDegreeToken("1"));
    this.validate();
  }

  get values() {
    return this.items.map(degreeText);
  }

  get rootValue() {
    return degreeText(this.rootDegree);
  }

  clone() {
    return new RomanStructure(this.items, this.rootDegree);
  }

  validate() {
    if (this.items.length < 1 || this.items.length > 12) {
      throw new RomanSyntaxError("structure-count", 0, 1, { count: this.items.length }, "A Roman structure must contain 1 to 12 degrees.");
    }
    for (const item of this.items) {
      if (!STRUCTURE_ACCIDENTALS.has(item.accidental) || item.degree < 1 || item.degree > 7) {
        throw new RomanSyntaxError("invalid-structure", 0, 1, { token: degreeText(item) }, "Invalid Roman structure.");
      }
    }
    return this;
  }

  append(relativeDegree) {
    const relative = typeof relativeDegree === "string" ? parseDegreeToken(relativeDegree) : cloneDegree(relativeDegree);
    const appended = combineDegrees(this.rootDegree, relative);
    this.items.push(appended);
    this.validate();
    return this;
  }

  removeRelative(relativeDegree) {
    const relative = typeof relativeDegree === "string" ? parseDegreeToken(relativeDegree) : cloneDegree(relativeDegree);
    const target = combineDegrees(this.rootDegree, relative);
    const index = this.items.findIndex((item) => item.degree === target.degree && item.accidental === target.accidental);
    if (index === -1) throw new RomanSyntaxError("degree-removal-missing", 0, 1, { token: degreeText(target) }, `Roman degree ${degreeText(target)} is not present.`);
    this.items.splice(index, 1);
    return this.validate();
  }

  replaceRelative(fromDegree, toDegree) {
    const from = combineDegrees(this.rootDegree, typeof fromDegree === "string" ? parseDegreeToken(fromDegree) : fromDegree);
    const to = combineDegrees(this.rootDegree, typeof toDegree === "string" ? parseDegreeToken(toDegree) : toDegree);
    const index = this.items.findIndex((item) => item.degree === from.degree && item.accidental === from.accidental);
    if (index === -1) throw new RomanSyntaxError("degree-replacement-missing", 0, 1, { token: degreeText(from) }, `Roman degree ${degreeText(from)} is not present.`);
    this.items[index] = to;
    return this.validate();
  }

  replaceWithFigures(figures) {
    const root = cloneDegree(this.rootDegree);
    this.items = [root];
    for (const figure of [...figures].reverse()) {
      this.append(figure);
    }
    this.items = this.items.filter((item, index, items) => items.findIndex(
      (candidate) => candidate.degree === item.degree && candidate.accidental === item.accidental,
    ) === index);
    return this.validate();
  }

  rotate(count) {
    for (let index = 0; index < count; index += 1) this.items.push(this.items.shift());
    return this;
  }

  appliedTo(appliedDegree) {
    const applied = typeof appliedDegree === "string" ? parseDegreeToken(appliedDegree) : cloneDegree(appliedDegree);
    this.items = this.items.map((item) => combineDegrees(applied, item));
    this.rootDegree = combineDegrees(applied, this.rootDegree);
    return this.validate();
  }
}

export function parseRomanCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Invalid Roman-config CSV quoting.");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function configRows(text, expected, label) {
  const [header, ...rows] = parseRomanCsvRows(text);
  if (!header || header.length !== expected.length || expected.some((name, index) => header[index] !== name)) {
    throw new Error(`Invalid ${label} CSV header.`);
  }
  for (const row of rows) if (row.length !== expected.length) throw new Error(`Invalid ${label} CSV row.`);
  return rows.map((row) => row.map((cell) => cell.trim()));
}

function parseBoolean(value, label) {
  if (value === "") return false;
  if (value === "True") return true;
  throw new Error(`${label} must be blank or True.`);
}

function csvList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function ensureUnique(map, key, label) {
  if (map.has(key)) throw new Error(`Duplicate ${label}: ${key || "(blank)"}`);
}

export function parseRomanBasicCsv(text) {
  const rows = configRows(text, ["roman", "degree", "quality", "tonal_mode", "allowed_advanced"], "Roman basic-quality");
  const result = new Map();
  for (const [roman, degree, quality, tonalMode, allowedAdvancedText] of rows) {
    if (!isRomanBasicToken(roman)) throw new Error(`Invalid basic Roman token: ${roman}`);
    parseDegreeToken(degree, { maxDegree: 7 });
    if (!BASIC_QUALITIES.has(quality)) throw new Error(`Invalid basic Roman quality: ${quality}`);
    if (!TONAL_MODES.has(tonalMode)) throw new Error(`Invalid Roman tonal-mode restriction: ${tonalMode}`);
    ensureUnique(result, roman, "basic Roman token");
    result.set(roman, {
      roman,
      degree,
      quality,
      tonalMode,
      allowedAdvanced: csvList(allowedAdvancedText),
    });
  }
  if (!result.size) throw new Error("Roman basic-quality CSV cannot be empty.");
  return result;
}

export function parseRomanAdvancedCsv(text) {
  const rows = configRows(text, ["token", "append_degree", "requires_seventh", "seventh_override", "allowed_figured_bass"], "Roman advanced-quality");
  const result = new Map();
  for (const [token, appendDegree, requiresSeventhText, seventhOverride, allowedFiguredText] of rows) {
    if (token && !/^[A-Za-z+]+$/.test(token)) throw new Error(`Invalid advanced Roman token: ${token}`);
    parseDegreeToken(appendDegree, { maxDegree: 7 });
    if (seventhOverride !== "none") parseDegreeToken(seventhOverride, { maxDegree: 7 });
    ensureUnique(result, token, "advanced Roman token");
    result.set(token, {
      token,
      appendDegree,
      requiresSeventh: parseBoolean(requiresSeventhText, `${token || "blank"} requires_seventh`),
      seventhOverride,
      allowedFiguredBass: csvList(allowedFiguredText),
    });
  }
  if (!result.has("")) throw new Error("Roman advanced-quality CSV requires a blank default row.");
  return result;
}

export function parseRomanFiguredBassCsv(text) {
  const rows = configRows(text, ["token", "adds_seventh", "inversion", "operation", "render_upper", "render_lower"], "Roman figured-bass");
  const result = new Map();
  for (const [token, addsSeventhText, inversionText, operation, renderUpper, renderLower] of rows) {
    if (!/^(?:\d+(?:b\d+)?|sus|7sus|7b5sus)$/.test(token)) throw new Error(`Invalid figured-bass token: ${token}`);
    const inversion = inversionText === "" ? 0 : Number(inversionText);
    if (!Number.isInteger(inversion) || inversion < 0 || inversion > 11) throw new Error(`Invalid figured-bass inversion: ${inversionText}`);
    if (operation && !["flatten_fifth", "remove_third", "suspended_seventh", "suspended_seventh_flat_fifth"].includes(operation)) throw new Error(`Invalid figured-bass operation: ${operation}`);
    if (!renderUpper) throw new Error(`Figured bass ${token} needs render_upper.`);
    if (/^(?:[1-9]\d*)?sus$/.test(renderUpper)) {
      const leadingNumber = renderUpper.slice(0, -3);
      if (leadingNumber && Number(leadingNumber) > 14) throw new Error(`Invalid figured-bass upper display: ${renderUpper}`);
    } else parseDegreeToken(renderUpper, { allowNatural: true, maxDegree: 14 });
    if (renderLower) parseDegreeToken(renderLower, { allowNatural: true, maxDegree: 14 });
    ensureUnique(result, token, "figured-bass token");
    result.set(token, {
      token,
      addsSeventh: parseBoolean(addsSeventhText, `${token} adds_seventh`),
      inversion,
      operation,
      renderUpper,
      renderLower,
    });
  }
  if (!result.size) throw new Error("Roman figured-bass CSV cannot be empty.");
  return result;
}

export function parseRomanSpecialCsv(text) {
  const rows = configRows(text, ["token", "root_degree", "roman_structure", "base_text", "superscript_text", "figure_upper", "figure_lower", "allowed_figured_bass", "requires_figured_bass", "seventh_override", "note_name_special"], "Roman special");
  const result = new Map();
  for (const [token, rootDegree, structureText, baseText, superscriptText, figureUpper, figureLower, allowedFiguredText, requiresFiguredText, seventhOverride, noteNameSpecial] of rows) {
    if (!/^[A-Za-z0-9+]+$/.test(token) || !baseText) throw new Error(`Invalid special Roman identity: ${token}`);
    parseDegreeToken(rootDegree, { maxDegree: 7 });
    const structureValues = structureText.split(/\s+/).filter(Boolean);
    const structure = structureValues.length ? structureValues : null;
    if (structure) new RomanStructure(structure, rootDegree);
    if (figureUpper) parseDegreeToken(figureUpper, { allowNatural: true, maxDegree: 14 });
    if (figureLower) parseDegreeToken(figureLower, { allowNatural: true, maxDegree: 14 });
    if (seventhOverride) parseDegreeToken(seventhOverride, { maxDegree: 7 });
    if (!SPECIAL_NOTE_NAME_MODES.has(noteNameSpecial)) throw new Error(`Invalid Roman note-name special: ${noteNameSpecial}`);
    ensureUnique(result, token, "special Roman token");
    result.set(token, {
      token,
      rootDegree,
      structure,
      baseText,
      superscriptText,
      figureUpper,
      figureLower,
      allowedFiguredBass: csvList(allowedFiguredText),
      requiresFiguredBass: parseBoolean(requiresFiguredText, `${token} requires_figured_bass`),
      seventhOverride,
      noteNameSpecial,
    });
  }
  if (!result.size) throw new Error("Roman special CSV cannot be empty.");
  return result;
}

export function parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv }) {
  const basics = parseRomanBasicCsv(basicCsv);
  const advanced = parseRomanAdvancedCsv(advancedCsv);
  const figuredBass = parseRomanFiguredBassCsv(figuredBassCsv);
  const specials = parseRomanSpecialCsv(specialCsv);
  for (const basic of basics.values()) {
    for (const token of basic.allowedAdvanced) {
      if (!token || !advanced.has(token)) throw new Error(`Basic Roman ${basic.roman} references unknown advanced quality: ${token}`);
    }
  }
  for (const entry of [...advanced.values(), ...specials.values()]) {
    for (const token of entry.allowedFiguredBass) {
      if (token !== "[]" && !figuredBass.has(token)) throw new Error(`Roman config references unknown figured bass: ${token}`);
    }
  }
  return { basics, advanced, figuredBass, specials };
}

function sortedEntries(map, includeBlank = false) {
  return [...map.values()]
    .filter((entry) => includeBlank || entry.token !== "")
    .sort((left, right) => (right.token ?? right.roman).length - (left.token ?? left.roman).length);
}

function validateTonalMode(entry, tonalMode, parser, start, end) {
  if (entry.tonalMode && entry.tonalMode !== tonalMode) {
    parser.error("tonal-mode", start, end, { token: entry.roman, required: entry.tonalMode, actual: tonalMode }, `Roman numeral ${entry.roman} is not available in this tonal mode.`);
  }
}

function displayQuality(token) {
  if (token.startsWith("ho")) return `ø${token.slice(2)}`;
  return token;
}

class RomanParser {
  constructor(input, config, tonalMode, chainContext) {
    this.input = input;
    this.config = config;
    this.tonalMode = tonalMode;
    this.chainContext = chainContext ?? null;
    this.pos = 0;
  }

  error(code, start = this.pos, end = Math.min(this.input.length, start + 1), details = {}, message = code) {
    throw new RomanSyntaxError(code, start, Math.max(start + 1, end), details, message);
  }

  match(entries, field = "token") {
    return entries.find((entry) => this.input.startsWith(entry[field], this.pos));
  }

  consumeText(value) {
    const start = this.pos;
    this.pos += value.length;
    return { start, end: this.pos };
  }

  parseGeneralFigures(isPure) {
    const start = this.pos;
    if (this.input[this.pos] !== "[") return null;
    const close = this.input.indexOf("]", this.pos + 1);
    if (close === -1) this.error("figured-bracket-close", start, this.input.length, {}, "General figured bass needs a closing bracket.");
    let body = this.input.slice(this.pos + 1, close);
    let link = "end";
    if (body.endsWith("-x")) {
      link = "break";
      body = body.slice(0, -2);
    } else if (body.endsWith("-")) {
      link = "continue";
      body = body.slice(0, -1);
    }
    const rawParts = body.split(",");
    if (rawParts.length < 2 || rawParts.length > 4) this.error("figured-count", start + 1, close, { count: rawParts.length }, "General figured bass needs two to four figures.");
    const figures = [];
    let cursor = start + 1;
    let previous = Number.POSITIVE_INFINITY;
    for (const rawPart of rawParts) {
      const leading = rawPart.length - rawPart.trimStart().length;
      const value = rawPart.trim();
      const spanStart = cursor + leading;
      const parsed = parseDegreeToken(value, { allowNatural: true, maxDegree: 14, start: spanStart, end: spanStart + Math.max(1, value.length) });
      if (parsed.degree < 2) this.error("figured-range", spanStart, spanStart + value.length, { token: value }, "General figured-bass numbers must be from 2 to 14.");
      if (parsed.degree > previous) this.error("figured-order", spanStart, spanStart + value.length, { token: value }, "General figured-bass numbers must descend.");
      previous = parsed.degree;
      figures.push({ ...parsed, text: value, start: spanStart, end: spanStart + value.length });
      cursor += rawPart.length + 1;
    }
    this.pos = close + 1;
    if (!isPure && link === "end") this.error("figured-chain-required", close - 1, close, {}, "The first general figured-bass event must continue with - or terminate with -x.");
    return { figures, link, start, end: this.pos, pure: isPure };
  }

  parseApplied(structure) {
    const applied = [];
    while (this.input[this.pos] === "/") {
      const slashStart = this.pos;
      this.pos += 1;
      if (applied.length >= 2) this.error("applied-depth", slashStart, this.input.length, {}, "Applied Roman numerals can nest at most twice.");
      const targetStart = this.pos;
      const target = this.match([...this.config.basics.values()].sort((left, right) => right.roman.length - left.roman.length), "roman");
      if (!target) this.error("applied-target", targetStart, this.input.length, {}, "Applied Roman numerals require a configured basic Roman degree.");
      this.pos += target.roman.length;
      validateTonalMode(target, this.tonalMode, this, targetStart, this.pos);
      structure?.appliedTo(target.degree);
      applied.push({ roman: target.roman, degree: target.degree, start: targetStart, end: this.pos });
    }
    return applied;
  }

  parseStandardFigure(structure, entry, quality, advancedToken, isSpecial = false) {
    const figures = sortedEntries(this.config.figuredBass);
    const figured = this.match(figures);
    if (!figured) return null;
    const start = this.pos;
    this.pos += figured.token.length;
    if (!entry.allowedFiguredBass.includes(figured.token)) {
      this.error("figured-not-allowed", start, this.pos, { token: figured.token }, `Figured bass ${figured.token} is not allowed here.`);
    }
    if (figured.operation === "flatten_fifth" && !isSpecial && !["M", "D"].includes(quality) && !["DM", "M"].includes(advancedToken)) {
      this.error("figured-flat-five-quality", start, this.pos, { token: figured.token }, "7b5 is not available on a minor-quality Roman numeral.");
    }
    if (["remove_third", "suspended_seventh", "suspended_seventh_flat_fifth"].includes(figured.operation)
      && !["M", "D"].includes(quality)) {
      this.error("figured-sus-quality", start, this.pos, { token: figured.token }, "Sus figures are limited to major or dominant Roman numerals.");
    }
    if (figured.addsSeventh) {
      const override = entry.seventhOverride && entry.seventhOverride !== "none" ? entry.seventhOverride : null;
      const seventh = override ?? (quality === "M" ? "7" : "b7");
      structure.append(seventh);
    }
    if (figured.operation === "flatten_fifth") structure.replaceRelative("5", "b5");
    if (figured.operation === "remove_third") structure.removeRelative(quality === "m" ? "b3" : "3");
    if (["suspended_seventh", "suspended_seventh_flat_fifth"].includes(figured.operation)) {
      structure.removeRelative(quality === "m" ? "b3" : "3");
      structure.replaceRelative(entry.appendDegree, figured.operation === "suspended_seventh" ? "5" : "b5");
    }
    if (figured.inversion) structure.rotate(figured.inversion);
    return { type: "standard", token: figured.token, upper: figured.renderUpper, lower: figured.renderLower, start, end: this.pos, addsSeventh: figured.addsSeventh };
  }

  parse() {
    if (!this.input) this.error("empty", 0, 1, {}, "Enter a Roman numeral.");
    let structure;
    let baseDegree;
    let baseText = "";
    let superscriptText = "";
    let configuredFigure = null;
    let generalFigure = null;
    let noteNameSpecial = "";
    let baseQuality = null;
    let advancedToken = "";
    let requiresSeventh = false;
    let seventhAdded = false;
    let isSpecial = false;
    const atoms = [];
    const warnings = [];

    if (this.input[this.pos] === "[") {
      if (!this.chainContext) this.error("pure-figured-without-chain", this.pos, this.pos + 1, {}, "A pure figured-bass event needs an active figured-bass chain.");
      baseDegree = this.chainContext.rootDegree;
      structure = new RomanStructure([baseDegree], baseDegree);
      generalFigure = this.parseGeneralFigures(true);
      atoms.push(this.input.slice(generalFigure.start, generalFigure.end));
      structure.replaceWithFigures(generalFigure.figures);
    } else {
      const special = this.match(sortedEntries(this.config.specials));
      if (special) {
        isSpecial = true;
        const start = this.pos;
        this.pos += special.token.length;
        atoms.push(this.input.slice(start, this.pos));
        structure = special.structure ? new RomanStructure(special.structure, special.rootDegree) : null;
        baseDegree = special.rootDegree;
        baseText = special.baseText;
        superscriptText = displayQuality(special.superscriptText);
        configuredFigure = special.figureUpper ? { type: "configured", upper: special.figureUpper, lower: special.figureLower } : null;
        noteNameSpecial = special.noteNameSpecial;
        if (this.input[this.pos] === "[") {
          if (!special.allowedFiguredBass.includes("[]")) this.error("figured-not-allowed", this.pos, this.pos + 1, { token: "[]", base: special.token }, "General figured bass is not allowed here.");
          generalFigure = this.parseGeneralFigures(false);
          atoms.push(this.input.slice(generalFigure.start, generalFigure.end));
          structure.replaceWithFigures(generalFigure.figures);
        } else {
          const figured = this.parseStandardFigure(structure, special, null, "", true);
          if (figured) {
            configuredFigure = figured;
            atoms.push(this.input.slice(figured.start, figured.end));
            seventhAdded = figured.addsSeventh;
          }
        }
        if (special.requiresFiguredBass && !generalFigure && !configuredFigure) {
          this.error("figured-required", start, this.pos, { token: special.token }, `Roman numeral ${special.token} requires figured bass.`);
        }
      } else {
        const basic = this.match([...this.config.basics.values()].sort((left, right) => right.roman.length - left.roman.length), "roman");
        if (!basic) this.error("base-not-found", this.pos, this.input.length, { token: this.input }, "Unknown Roman base quality.");
        const baseStart = this.pos;
        this.pos += basic.roman.length;
        atoms.push(this.input.slice(baseStart, this.pos));
        validateTonalMode(basic, this.tonalMode, this, baseStart, this.pos);
        baseDegree = basic.degree;
        baseQuality = basic.quality;
        baseText = basic.roman;
        structure = new RomanStructure([basic.degree], basic.degree);
        structure.append(basic.quality === "m" ? "b3" : "3");

        const allAdvanced = sortedEntries(this.config.advanced);
        const advanced = this.match(allAdvanced) ?? this.config.advanced.get("");
        const thirdQualities = Object.hasOwn(ADVANCED_THIRD_QUALITIES, advanced.token)
          ? ADVANCED_THIRD_QUALITIES[advanced.token] : null;
        if (advanced.token && thirdQualities && !thirdQualities.includes(basic.quality)) {
          this.error("advanced-third-quality", this.pos, this.pos + advanced.token.length,
            { token: advanced.token, base: basic.roman }, "The advanced quality conflicts with the Roman numeral's third.");
        }
        if (advanced.token === "M" && basic.roman !== "V" && /[IV]$/.test(basic.roman)) {
          this.error("advanced-redundant-major-seventh", this.pos, this.pos + advanced.token.length,
            { token: advanced.token, base: basic.roman }, "The major seventh is already implied by this uppercase Roman numeral. Omit M.");
        }
        if (advanced.token && !basic.allowedAdvanced.includes(advanced.token)) {
          if (!thirdQualities) this.error("advanced-not-allowed", this.pos, this.pos + advanced.token.length,
            { token: advanced.token, base: basic.roman }, "This configured advanced quality is not allowed here.");
          warnings.push({ code: "advanced-not-recommended", severity: "warning", start: baseStart,
            end: this.pos + advanced.token.length, details: { token: advanced.token, base: basic.roman } });
        }
        if (advanced.token) {
          const advancedStart = this.pos;
          this.pos += advanced.token.length;
          atoms.push(this.input.slice(advancedStart, this.pos));
        }
        advancedToken = advanced.token;
        superscriptText = displayQuality(advanced.token);
        structure.append(advanced.appendDegree);
        requiresSeventh = advanced.requiresSeventh;

        if (this.input[this.pos] === "[") {
          if (!advanced.allowedFiguredBass.includes("[]")) this.error("figured-not-allowed", this.pos, this.pos + 1, { token: "[]" }, "General figured bass is not allowed here.");
          generalFigure = this.parseGeneralFigures(false);
          atoms.push(this.input.slice(generalFigure.start, generalFigure.end));
          structure.replaceWithFigures(generalFigure.figures);
        } else {
          const figured = this.parseStandardFigure(structure, advanced, basic.quality, advanced.token);
          if (figured) {
            configuredFigure = figured;
            atoms.push(this.input.slice(figured.start, figured.end));
            seventhAdded = figured.addsSeventh;
          }
        }
        if (requiresSeventh && !seventhAdded) {
          this.error("seventh-required", baseStart, this.pos, { token: advanced.token }, `Advanced quality ${advanced.token} requires a seventh figure.`);
        }
      }
    }

    const applied = this.parseApplied(structure);
    for (const entry of applied) atoms.push("/", this.input.slice(entry.start, entry.end));
    if (this.pos < this.input.length) this.error("unexpected-token", this.pos, this.input.length, { token: this.input.slice(this.pos) }, `Unexpected Roman token ${this.input.slice(this.pos)}.`);
    if (generalFigure && this.chainContext) {
      if (generalFigure.figures.length !== this.chainContext.figureCount) {
        this.error("figured-chain-count", generalFigure.start, generalFigure.end, { expected: this.chainContext.figureCount, actual: generalFigure.figures.length }, "Every event in a figured-bass chain must contain the same number of figures.");
      }
      const actualApplied = applied.map((entry) => entry.roman);
      if (actualApplied.join("/") !== this.chainContext.applied.join("/")) {
        this.error("figured-chain-applied", generalFigure.start, this.input.length, { expected: this.chainContext.applied, actual: actualApplied }, "Every event in a figured-bass chain must use the same applied Roman degrees.");
      }
    }
    return {
      source: this.input,
      structure,
      baseDegree,
      baseQuality,
      baseText,
      superscriptText,
      figure: configuredFigure,
      generalFigure,
      applied,
      atoms,
      noteNameSpecial,
      isSpecial,
      warnings,
    };
  }
}

export function parseRomanSymbol(input, options = {}) {
  const source = String(input ?? "");
  if (!options.config) throw new TypeError("parseRomanSymbol requires a Roman config.");
  const tonalMode = options.tonalMode === "m" ? "m" : "M";
  return new RomanParser(source, options.config, tonalMode, options.chainContext).parse();
}

/** Search checks lexical structure without claiming any configured meaning. */
export function validateRomanSearchSource(source) {
  const parser = new RomanParser(source, null, "M", null);
  const head = source.split(/[\[/]/, 1)[0];
  if (head && !/^[A-Za-z0-9+]+$/.test(head)
    && !/^(?:#|x)(?:I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii)[A-Za-z0-9+]*$/.test(head)) parser.error("unexpected-token", 0, source.length);
  if (!head && !source.startsWith("[")) parser.error("empty", 0, 1);
  parser.pos = head.length;
  if (source[parser.pos] === "[") parser.parseGeneralFigures(!head);
  let depth = 0;
  while (source[parser.pos] === "/") {
    const start = ++parser.pos;
    const end = source.indexOf("/", start);
    const target = source.slice(start, end === -1 ? source.length : end);
    if (++depth > 2 || !isRomanBasicToken(target)) parser.error("applied-target", start, source.length);
    parser.pos += target.length;
  }
  if (parser.pos !== source.length) parser.error("unexpected-token", parser.pos, source.length);
  return source;
}

export function romanDisplayGlyphs(text) {
  return String(text)
    .replace(/bb(?=\d|[IViv])/g, "𝄫")
    .replace(/b(?=\d|[IViv])/g, "♭")
    .replace(/#(?=\d|[IViv])/g, "♯")
    .replace(/x(?=\d|[IViv])/g, "𝄪")
    .replace(/n(?=\d|[IViv])/g, "♮");
}
