import { isAsciiRomanized, isSongLength } from "./mstruct-document.js";
import { addRational, parseFraction, rational, rationalLabel } from "./mstruct-rational.js";
import { normalizeMetadataLinks, readMetadataLink, serializeScoreLinks, serializeExternalLinks } from "./metadata-links.js";

export const MAX_MSTRUCTTIME_PERFORMERS = 100;

function scalar(value) {
  return String(value ?? "").replace(/[\r\n]+/g, "").trim();
}

function error(line, code, details = {}) {
  return { line, code, details, message: code };
}

function containsNonAscii(value) {
  return /[^\x00-\x7F]/.test(String(value ?? ""));
}

function emptyPerformer() {
  return { name: "", romanized: "" };
}

export function createEmptyMstructtimeMetadata() {
  return {
    name: "",
    nameRomanized: "",
    performers: [emptyPerformer()],
    recordAlbum: "",
    recordAlbumRomanized: "",
    recordYear: "",
    musicLength: "",
    ...normalizeMetadataLinks(),
  };
}

export function normalizeMstructtimeMetadata(value = {}) {
  const performers = (Array.isArray(value.performers) ? value.performers : [])
    .slice(0, MAX_MSTRUCTTIME_PERFORMERS)
    .map((performer) => ({ name: scalar(performer?.name), romanized: scalar(performer?.romanized) }))
    .filter((performer) => performer.name || performer.romanized);
  return {
    name: scalar(value.name),
    nameRomanized: scalar(value.nameRomanized),
    performers: performers.length ? performers : [emptyPerformer()],
    recordAlbum: scalar(value.recordAlbum),
    recordAlbumRomanized: scalar(value.recordAlbumRomanized),
    recordYear: scalar(value.recordYear),
    musicLength: scalar(value.musicLength),
    ...normalizeMetadataLinks(value),
  };
}

export function validateMstructtimeMetadata(value) {
  const metadata = normalizeMstructtimeMetadata(value);
  const errors = [];
  if (!metadata.name) errors.push(error(1, "mstructtime-name-required"));
  if (containsNonAscii(metadata.name) && !metadata.nameRomanized) errors.push(error(1, "mstructtime-name-romanized-required"));
  if (!isAsciiRomanized(metadata.nameRomanized)) errors.push(error(1, "mstructtime-romanized-ascii"));
  const actualPerformers = metadata.performers.filter((performer) => performer.name || performer.romanized);
  if (!actualPerformers.some((performer) => performer.name)) errors.push(error(1, "mstructtime-performer-required"));
  actualPerformers.forEach((performer, index) => {
    if (!performer.name) errors.push(error(1, "mstructtime-performer-name-required", { count: index + 1 }));
    if (containsNonAscii(performer.name) && !performer.romanized) errors.push(error(1, "mstructtime-performer-romanized-required", { count: index + 1 }));
    if (!isAsciiRomanized(performer.romanized)) errors.push(error(1, "mstructtime-romanized-ascii", { count: index + 1 }));
  });
  if (containsNonAscii(metadata.recordAlbum) && !metadata.recordAlbumRomanized) errors.push(error(1, "mstructtime-album-romanized-required"));
  if (!isAsciiRomanized(metadata.recordAlbumRomanized)) errors.push(error(1, "mstructtime-romanized-ascii"));
  if (metadata.recordYear && !/^\d+$/.test(metadata.recordYear)) errors.push(error(1, "mstructtime-year-integer"));
  if (!metadata.musicLength) errors.push(error(1, "mstructtime-length-required"));
  else if (!isSongLength(metadata.musicLength)) errors.push(error(1, "mstructtime-length-invalid"));
  return { ok: errors.length === 0, metadata, errors };
}

function metadataLine(tag, value) {
  return `{${tag}}${value}`;
}

export function serializeMstructtimeMetadata(value) {
  const metadata = normalizeMstructtimeMetadata(value);
  const lines = [
    metadataLine("MSTRUCTTIME_NAME", metadata.name),
    metadataLine("MSTRUCTTIME_NAME_ROMANIZED", metadata.nameRomanized),
    "",
  ];
  metadata.performers.filter((performer) => performer.name || performer.romanized).forEach((performer, index) => {
    lines.push(metadataLine(`PERFORMER_${index + 1}`, performer.name));
    lines.push(metadataLine(`PERFORMER_${index + 1}_ROMANIZED`, performer.romanized));
  });
  lines.push("");
  lines.push(metadataLine("RECORD_ALBUM", metadata.recordAlbum));
  lines.push(metadataLine("RECORD_ALBUM_ROMANIZED", metadata.recordAlbumRomanized));
  lines.push(metadataLine("RECORD_YEAR", metadata.recordYear));
  lines.push(metadataLine("MUSIC_LENGTH", metadata.musicLength));
  lines.push("", ...serializeScoreLinks(metadata), "", ...serializeExternalLinks(metadata));
  return lines.join("\n");
}

function parseMetadata(block) {
  const metadata = createEmptyMstructtimeMetadata();
  metadata.performers = [];
  const errors = [];
  for (const [index, rawLine] of block.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^\{([^{}]+)\}(.*)$/.exec(line);
    if (!match) {
      errors.push(error(index + 1, "mstructtime-metadata-line"));
      continue;
    }
    const [, tag, rawValue] = match;
    const value = rawValue.trim();
    const link = readMetadataLink(metadata, tag, value);
    if (link) {
      if (link.code) errors.push(error(index + 1, link.code, link.details));
      continue;
    }
    const performerMatch = /^PERFORMER_(\d+)(?:_(ROMANIZED))?$/.exec(tag);
    if (tag === "MSTRUCTTIME_NAME") metadata.name = value;
    else if (tag === "MSTRUCTTIME_NAME_ROMANIZED") metadata.nameRomanized = value;
    else if (performerMatch) {
      const number = Number(performerMatch[1]);
      if (number < 1 || number > MAX_MSTRUCTTIME_PERFORMERS) {
        errors.push(error(index + 1, "mstructtime-performer-limit", { count: MAX_MSTRUCTTIME_PERFORMERS }));
        continue;
      }
      while (metadata.performers.length < number) metadata.performers.push(emptyPerformer());
      metadata.performers[number - 1][performerMatch[2] ? "romanized" : "name"] = value;
    } else if (tag === "RECORD_ALBUM") metadata.recordAlbum = value;
    else if (tag === "RECORD_ALBUM_ROMANIZED") metadata.recordAlbumRomanized = value;
    else if (tag === "RECORD_YEAR") metadata.recordYear = value;
    else if (tag === "MUSIC_LENGTH") metadata.musicLength = value;
    else errors.push(error(index + 1, "mstructtime-metadata-field", { tag }));
  }
  const validated = validateMstructtimeMetadata(metadata);
  return { metadata: validated.metadata, errors: [...errors, ...validated.errors] };
}

function location(value) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(value ?? "").trim());
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) return null;
  return { numerator: Number(match[1]), denominator: Number(match[2]), label: `${Number(match[1])}/${Number(match[2])}` };
}

export function parseMstructtimeLoop(input) {
  const source = String(input ?? "").replace(/\r\n?/g, "\n");
  const instructions = [];
  const errors = [];
  const seen = new Set();
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const jumpMatch = /^(\d+)\s*,\s*(\d+\s*\/\s*\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+\s*\/\s*\d+)\s*;$/.exec(line);
    const endMatch = /^(\d+)\s*,\s*(\d+\s*\/\s*\d+)\s*,\s*(\d+)\s*,\s*end\s*;$/i.exec(line);
    const match = jumpMatch ?? endMatch;
    if (!match) {
      errors.push(error(index + 1, "mstructtime-loop-instruction"));
      continue;
    }
    const sourceLocation = location(match[2]);
    const targetLocation = jumpMatch ? location(match[5]) : null;
    const instruction = {
      type: jumpMatch ? "jump" : "end",
      line: index + 1,
      sourceMeasure: Number(match[1]),
      sourceLocation,
      pass: Number(match[3]),
      targetMeasure: jumpMatch ? Number(match[4]) : null,
      targetLocation,
    };
    if (!sourceLocation || (jumpMatch && !targetLocation) || instruction.pass < 1) {
      errors.push(error(index + 1, "mstructtime-loop-location"));
      continue;
    }
    const key = `${instruction.sourceMeasure}:${sourceLocation.label}:${instruction.pass}`;
    if (seen.has(key)) {
      errors.push(error(index + 1, "mstructtime-loop-duplicate"));
      continue;
    }
    seen.add(key);
    instructions.push(instruction);
  }
  return { ok: errors.length === 0, source, instructions, errors };
}

export function mstructtimeTimestampKey({ kind = "event", measure, position, pass }) {
  return `${kind}:${measure}:${rationalLabel(position)}:${pass}`;
}

export function parseMstructtimeMain(input) {
  const source = String(input ?? "").replace(/\r\n?/g, "\n");
  const entries = [];
  const errors = [];
  const seen = new Set();
  let index = 0;
  let line = 1;
  let barNumber = 1;
  let position = rational(0);
  let division = null;
  let kind = "event";

  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index])) {
      if (source[index] === "\n") line += 1;
      index += 1;
    }
  };
  const addTimestamp = (millisecondsText, passText) => {
    const pass = Number(passText);
    const milliseconds = millisecondsText === "" ? null : Number(millisecondsText);
    const item = { kind, measure: barNumber, position, pass, milliseconds };
    const key = mstructtimeTimestampKey(item);
    if (pass < 1 || (milliseconds !== null && (!Number.isSafeInteger(milliseconds) || milliseconds < 0))) {
      errors.push(error(line, "mstructtime-main-timestamp"));
    } else if (seen.has(key)) {
      errors.push(error(line, "mstructtime-main-duplicate"));
    } else {
      seen.add(key);
      entries.push(item);
    }
  };

  while (index < source.length) {
    skipWhitespace();
    if (index >= source.length) break;
    if (source.startsWith("...", index)) {
      kind = "ellipsis";
      index += 3;
      continue;
    }
    if (source[index] === "{") {
      const end = source.indexOf("}", index + 1);
      if (end < 0) {
        errors.push(error(line, "mstructtime-main-setting"));
        break;
      }
      const content = source.slice(index + 1, end).trim();
      const setting = /^([A-Za-z]+)\s*:\s*(.+)$/.exec(content);
      if (!setting) errors.push(error(line, "mstructtime-main-setting"));
      else if (setting[1].toUpperCase() === "BN" && /^\d+$/.test(setting[2])) barNumber = Number(setting[2]);
      else if (setting[1].toUpperCase() === "D") {
        division = parseFraction(setting[2]);
        if (!division) errors.push(error(line, "mstructtime-main-division"));
      } else if (setting[1].toUpperCase() !== "TS") errors.push(error(line, "mstructtime-main-setting"));
      index = end + 1;
      continue;
    }
    if (source[index] === "[") {
      const end = source.indexOf("]", index + 1);
      if (end < 0) {
        errors.push(error(line, "mstructtime-main-timestamp"));
        break;
      }
      const match = /^\s*(\d*)\s*,\s*(\d+)\s*$/.exec(source.slice(index + 1, end));
      if (!match) errors.push(error(line, "mstructtime-main-timestamp"));
      else addTimestamp(match[1], match[2]);
      index = end + 1;
      continue;
    }
    if (source[index] === ",") {
      if (!division) errors.push(error(line, "mstructtime-main-missing-division"));
      else position = addRational(position, division);
      kind = "event";
      index += 1;
      continue;
    }
    if (source[index] === ";") {
      barNumber += 1;
      position = rational(0);
      kind = "event";
      index += 1;
      continue;
    }
    errors.push(error(line, "mstructtime-main-token"));
    index += 1;
  }
  return { ok: errors.length === 0, source, entries, errors };
}

export function serializeMstructtimeDocument({ metadata, loop = "", main = "" }) {
  return [
    "METADATA:",
    "",
    serializeMstructtimeMetadata(metadata),
    "",
    "END_METADATA",
    "",
    "LOOP:",
    "",
    String(loop ?? "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, ""),
    "",
    "END_LOOP",
    "",
    "MAIN:",
    "",
    String(main ?? "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, ""),
    "",
    "END_MAIN",
  ].join("\n");
}

export function parseMstructtimeDocument(input) {
  const source = String(input ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const envelope = /^METADATA:\s*\n([\s\S]*?)\nEND_METADATA\s*\n+LOOP:\s*\n([\s\S]*?)\nEND_LOOP\s*\n+MAIN:\s*\n([\s\S]*?)\nEND_MAIN\s*$/.exec(source);
  if (!envelope) return { ok: false, metadata: createEmptyMstructtimeMetadata(), loop: "", main: "", entries: [], errors: [error(1, "mstructtime-envelope")] };
  const metadata = parseMetadata(envelope[1]);
  const loop = parseMstructtimeLoop(envelope[2].replace(/^\n+|\n+$/g, ""));
  const main = parseMstructtimeMain(envelope[3].replace(/^\n+|\n+$/g, ""));
  return {
    ok: metadata.errors.length === 0 && loop.ok && main.ok,
    metadata: metadata.metadata,
    loop: loop.source,
    main: main.source,
    entries: main.entries,
    instructions: loop.instructions,
    errors: [...metadata.errors, ...loop.errors, ...main.errors],
  };
}

export function musicLengthMilliseconds(value) {
  if (!isSongLength(value) || !value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

export function createMstructtimeFileName(parentFileName, randomValue = crypto.randomUUID()) {
  const parent = scalar(parentFileName || "untitled.mstruct").replace(/\.mstruct$/i, "") || "untitled";
  const safeParent = parent.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 70) || "untitled";
  const id = String(randomValue).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase().padEnd(8, "0");
  return `${safeParent}-time-${id}.mstructtime`;
}
