import { normalizeComments, parseCommentBlock, serializeCommentBlock } from "./mstruct-comments.js";
import { PROFILE_METADATA_FIELDS, readProfileIdentity } from "./profile-schema.js";
import { normalizeMetadataLinks, readMetadataLink, serializeScoreLinks, serializeExternalLinks } from "./metadata-links.js";
export { MAX_SCORE_URLS, MAX_ADDITIONAL_URLS } from "./metadata-links.js";

export const MAX_COMPOSERS = 9;
export const MAX_VOCALISTS = 20;
export const MAX_TAGS = 20;
export const MAX_MSTRUCTTIME_FILES = 100;

const REMOVED_RECORDING_FIELDS = new Set([
  "PERFORMER",
  "PERFORMER_ROMANIZED",
  "RECORD_ALBUM",
  "RECORD_ALBUM_ROMANIZED",
]);


function scalar(value) {
  return String(value ?? "").replace(/[\r\n]+/g, "").trim();
}

function listOf(value, maximum, makeItem) {
  const list = Array.isArray(value) ? value.slice(0, maximum) : [];
  return list.map(makeItem);
}

function emptyPerson() {
  return { name: "", romanized: "", alias: "", id: "" };
}


/**
 * EDITORS is a portable, comma-separated credit list. Keeping the normalized
 * value as an array prevents repeated saves from accumulating duplicate names.
 */
export function uniqueEditorNames(...values) {
  const names = [];
  const seen = new Set();
  const append = (value) => {
    const candidates = Array.isArray(value) ? value : String(value ?? "").split(",");
    for (const candidate of candidates) {
      const name = scalar(candidate);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  };
  values.forEach(append);
  return names;
}

export function createEmptyMetadata() {
  return {
    mstructFormatVersion: "",
    mstructProfileId: "",
    mstructProfileHash: "",
    authoringAppVersion: "",
    creator: "",
    editors: [],
    reposted: false,
    originalAnalyzer: "",
    originalAnalyzerRomanized: "",
    originalEditor: "",
    coEditors: [],
    versionName: "",
    songName: "",
    songNameRomanized: "",
    composers: [emptyPerson()],
    originalVocalists: [],
    albumName: "",
    albumNameRomanized: "",
    groupName: "",
    groupNameRomanized: "",
    sourceName: "",
    sourceNameRomanized: "",
    tags: [],
    globalTags: "",
    songLength: "",
    isStableTempo: false,
    offset: "0",
    mstructtimeFiles: [],
    ...normalizeMetadataLinks(),
    comments: "",
    extraFields: [],
  };
}

export function normalizeMetadata(value = {}) {
  const defaults = createEmptyMetadata();
  const composers = listOf(value.composers, MAX_COMPOSERS, (person) => ({
    name: scalar(person?.name),
    romanized: scalar(person?.romanized),
    alias: scalar(person?.alias),
    id: scalar(person?.id),
  }));
  const originalVocalists = listOf(value.originalVocalists, MAX_VOCALISTS, (person) => ({
    name: scalar(person?.name),
    romanized: scalar(person?.romanized),
  })).filter((vocalist) => vocalist.name || vocalist.romanized);
  if (!originalVocalists.length && (value.originalVocalist || value.originalVocalistRomanized)) {
    originalVocalists.push({ name: scalar(value.originalVocalist), romanized: scalar(value.originalVocalistRomanized) });
  }
  const tags = listOf(value.tags, MAX_TAGS, scalar).filter(Boolean);
  const extraFields = listOf(value.extraFields, 100, (item) => ({
    tag: scalar(item?.tag).replace(/[{}]/g, ""),
    value: scalar(item?.value),
  })).filter((item) => item.tag && !REMOVED_RECORDING_FIELDS.has(item.tag) && !Object.hasOwn(PROFILE_METADATA_FIELDS, item.tag));
  const mstructtimeFiles = listOf(value.mstructtimeFiles, MAX_MSTRUCTTIME_FILES, scalar).filter(Boolean);

  return {
    ...defaults,
    ...Object.fromEntries(Object.values(PROFILE_METADATA_FIELDS).map((field) => [field, scalar(value[field])])),
    // ANALYZER was the pre-creator field. Reading it here retains older files
    // while all newly serialized files use CREATOR.
    creator: scalar(value.creator ?? value.analyzer),
    editors: uniqueEditorNames(value.editors),
    reposted: value.reposted === true || value.reposted === "TRUE",
    originalAnalyzer: scalar(value.originalAnalyzer),
    originalAnalyzerRomanized: scalar(value.originalAnalyzerRomanized),
    originalEditor: scalar(value.originalEditor),
    coEditors: uniqueEditorNames(value.coEditors),
    versionName: scalar(value.versionName),
    songName: scalar(value.songName),
    songNameRomanized: scalar(value.songNameRomanized),
    composers: composers.length ? composers : defaults.composers,
    originalVocalists,
    // Retain these aliases for readers of older documents and integrations.
    originalVocalist: originalVocalists[0]?.name ?? "",
    originalVocalistRomanized: originalVocalists[0]?.romanized ?? "",
    albumName: scalar(value.albumName),
    albumNameRomanized: scalar(value.albumNameRomanized),
    groupName: scalar(value.groupName),
    groupNameRomanized: scalar(value.groupNameRomanized),
    sourceName: scalar(value.sourceName),
    sourceNameRomanized: scalar(value.sourceNameRomanized),
    tags,
    globalTags: scalar(value.globalTags),
    songLength: scalar(value.songLength),
    isStableTempo: value.isStableTempo === true || value.isStableTempo === "True",
    offset: scalar(value.offset ?? "0") || "0",
    mstructtimeFiles,
    ...normalizeMetadataLinks(value),
    comments: String(value.comments ?? "").replace(/\r\n?/g, "\n").trim(),
    extraFields,
  };
}

export function isSongLength(value) {
  return value === "" || /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/.test(value);
}

/** Romanized metadata entered through the editor is portable ASCII-only text. */
export function isAsciiRomanized(value) {
  return /^[\x00-\x7F]*$/.test(String(value ?? ""));
}

function localTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Uses local computer time so exported files are sortable without a server.
 * This intentionally keeps non-ASCII original song names when they are used
 * as the fallback name; only characters forbidden by common file systems go.
 */
export function createMstructFileName(metadata, date = new Date()) {
  const normalized = normalizeMetadata(metadata);
  const preferredName = normalized.songNameRomanized || normalized.songName || "untitled";
  const cleanName = preferredName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleanName || "untitled"}-${localTimestamp(date)}.mstruct`;
}

function metadataLine(tag, value) {
  return `{${tag}}${value}`;
}

/**
 * Writes the portable .mstruct document envelope. The score compiler consumes
 * only the text inside MAIN; track metadata remains an independent document block.
 */
/** @param {{metadata: any, main: any, comments?: any[]}} document */
export function serializeMstructDocument({ metadata, main, comments = [] }) {
  const normalized = normalizeMetadata(metadata);
  const lines = [
    "METADATA:",
    "",
    ...Object.entries(PROFILE_METADATA_FIELDS).filter(([, field]) => normalized[field])
      .map(([tag, field]) => metadataLine(tag, normalized[field])),
    metadataLine("REPOSTED", normalized.reposted ? "TRUE" : "FALSE"),
    ...(normalized.reposted ? [
      metadataLine("ORIGINAL_ANALYZER", normalized.originalAnalyzer),
      metadataLine("ORIGINAL_ANALYZER_ROMANIZED", normalized.originalAnalyzerRomanized),
      metadataLine("ORIGINAL_EDITOR", normalized.originalEditor),
      metadataLine("CO_EDITOR", normalized.coEditors.join(",")),
    ] : [
      metadataLine("CREATOR", normalized.creator),
      metadataLine("EDITORS", normalized.editors.join(",")),
    ]),
    metadataLine("VERSION_NAME", normalized.versionName),
    "",
    metadataLine("SONG_NAME", normalized.songName),
    metadataLine("SONG_NAME_ROMANIZED", normalized.songNameRomanized),
    "",
  ];

  normalized.composers.forEach((composer, index) => {
    const number = index + 1;
    lines.push(metadataLine(`COMPOSER_NAME_${number}`, composer.name));
    lines.push(metadataLine(`COMPOSER_NAME_${number}_ROMANIZED`, composer.romanized));
    lines.push(metadataLine(`COMPOSER_NAME_${number}_ALIAS`, composer.alias));
    lines.push(metadataLine(`COMPOSER_NAME_${number}_ID`, composer.id));
  });
  normalized.originalVocalists.forEach((vocalist, index) => {
    const number = index + 1;
    lines.push(metadataLine(`ORIGINAL_VOCALIST_${number}`, vocalist.name));
    lines.push(metadataLine(`ORIGINAL_VOCALIST_${number}_ROMANIZED`, vocalist.romanized));
  });
  lines.push("");
  lines.push(metadataLine("ALBUM_NAME", normalized.albumName));
  lines.push(metadataLine("ALBUM_NAME_ROMANIZED", normalized.albumNameRomanized));
  lines.push("");
  lines.push(metadataLine("GROUP_NAME", normalized.groupName));
  lines.push(metadataLine("GROUP_NAME_ROMANIZED", normalized.groupNameRomanized));
  lines.push("");
  lines.push(metadataLine("SOURCE_NAME", normalized.sourceName));
  lines.push(metadataLine("SOURCE_NAME_ROMANIZED", normalized.sourceNameRomanized));
  lines.push("");
  lines.push(metadataLine("TAG", normalized.tags.join(",")));
  lines.push(metadataLine("GLOBAL_TAGS", normalized.globalTags));
  lines.push("");
  lines.push(...serializeScoreLinks(normalized));
  lines.push("");
  lines.push(metadataLine("SONG_LENGTH", normalized.songLength));
  lines.push(metadataLine("IS_STABLE_TEMPO", normalized.isStableTempo ? "True" : "False"));
  lines.push(metadataLine("OFFSET", normalized.offset));
  lines.push("");
  normalized.mstructtimeFiles.forEach((fileName, index) => lines.push(metadataLine(`MSTRUCTTIME_${index + 1}`, fileName)));
  if (normalized.mstructtimeFiles.length) lines.push("");
  lines.push(...serializeExternalLinks(normalized));
  lines.push("");
  normalized.extraFields.forEach((field) => lines.push(metadataLine(field.tag, field.value)));
  if (normalized.extraFields.length) lines.push("");
  lines.push("{COMMENTS}");
  if (normalized.comments) lines.push(normalized.comments);
  lines.push("{COMMENTS_END}", "", "END_METADATA", "", "MAIN:", "");
  lines.push(String(main ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, ""));
  lines.push("", "END_MAIN", "", serializeCommentBlock(comments));
  return lines.join("\n");
}

function appendIndexed(list, index, makeItem) {
  while (list.length <= index) list.push(makeItem());
  return list[index];
}

function documentError(line, code, details = {}) {
  return { line, code, details, message: code };
}

function metadataEntriesForLine(line, lineNumber, errors) {
  const matches = [...line.matchAll(/\{([^{}]+)\}/g)];
  if (!matches.length || line.slice(0, matches[0]?.index ?? 0).trim()) {
    errors.push(documentError(lineNumber, "metadata-field-start"));
    return [];
  }
  return matches.map((match, index) => ({
    tag: match[1],
    value: line.slice(match.index + match[0].length, matches[index + 1]?.index).trim(),
  }));
}


function parseMetadataBlock(block) {
  const metadata = createEmptyMetadata();
  const errors = [];
  const profileFieldLines = new Map();
  const lines = block.split("\n");
  let commentLines = null;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (commentLines) {
      if (/^\{COMMENTS_END\}\s*$/.test(line)) {
        metadata.comments = commentLines.join("\n").replace(/^\n+|\n+$/g, "");
        commentLines = null;
      } else {
        commentLines.push(line);
      }
      continue;
    }
    if (!line.trim()) continue;
    if (/^\{COMMENTS\}\s*$/.test(line)) {
      commentLines = [];
      continue;
    }
    for (const { tag, value } of metadataEntriesForLine(line, lineNumber, errors)) {
      const composerMatch = tag.match(/^COMPOSER_NAME_(\d+)(?:_(ROMANIZED|ALIAS|ID))?$/);
      const vocalistMatch = tag.match(/^ORIGINAL_VOCALIST_(\d+)(?:_(ROMANIZED))?$/);
      const mstructtimeMatch = tag.match(/^MSTRUCTTIME_(\d+)$/);
      const link = readMetadataLink(metadata, tag, value);

      if (link) {
        if (link.code) errors.push(documentError(lineNumber, link.code, link.details));
      }
      else if (Object.hasOwn(PROFILE_METADATA_FIELDS, tag)) {
        if (profileFieldLines.has(tag)) errors.push(documentError(lineNumber + 1, "profile-field-duplicate", { field: tag }));
        else {
          profileFieldLines.set(tag, lineNumber + 1);
          metadata[PROFILE_METADATA_FIELDS[tag]] = value;
        }
      }
      else if (tag === "REPOSTED") {
        if (value !== "TRUE" && value !== "FALSE") errors.push(documentError(lineNumber, "reposted-boolean"));
        else metadata.reposted = value === "TRUE";
      }
      else if (tag === "CREATOR") metadata.creator = value;
      // Keep historic files readable. The first save upgrades the field to
      // CREATOR without losing its original attribution.
      else if (tag === "ANALYZER" && !metadata.creator) metadata.creator = value;
      else if (tag === "EDITORS") metadata.editors = uniqueEditorNames(value);
      else if (tag === "ORIGINAL_ANALYZER") metadata.originalAnalyzer = value;
      else if (tag === "ORIGINAL_ANALYZER_ROMANIZED") metadata.originalAnalyzerRomanized = value;
      else if (tag === "ORIGINAL_EDITOR") metadata.originalEditor = value;
      else if (tag === "CO_EDITOR") metadata.coEditors = uniqueEditorNames(value);
      else if (tag === "VERSION_NAME") metadata.versionName = value;
      else if (tag === "SONG_NAME") metadata.songName = value;
      else if (tag === "SONG_NAME_ROMANIZED") metadata.songNameRomanized = value;
      else if (composerMatch) {
        const number = Number(composerMatch[1]);
        if (number < 1 || number > MAX_COMPOSERS) errors.push(documentError(lineNumber, "composer-limit", { count: MAX_COMPOSERS }));
        else {
          const composer = appendIndexed(metadata.composers, number - 1, emptyPerson);
          const field = composerMatch[2] === "ROMANIZED" ? "romanized" : composerMatch[2] === "ALIAS" ? "alias" : composerMatch[2] === "ID" ? "id" : "name";
          composer[field] = value;
        }
      } else if (vocalistMatch) {
        const number = Number(vocalistMatch[1]);
        if (number < 1 || number > MAX_VOCALISTS) errors.push(documentError(lineNumber, "vocalist-limit", { count: MAX_VOCALISTS }));
        else {
          const vocalist = appendIndexed(metadata.originalVocalists, number - 1, () => ({ name: "", romanized: "" }));
          vocalist[vocalistMatch[2] === "ROMANIZED" ? "romanized" : "name"] = value;
        }
      } else if (tag === "ALBUM_NAME") metadata.albumName = value;
      else if (tag === "ORIGINAL_VOCALIST") metadata.originalVocalists = [{ name: value, romanized: "" }];
      else if (tag === "ORIGINAL_VOCALIST_ROMANIZED") {
        const vocalist = appendIndexed(metadata.originalVocalists, 0, () => ({ name: "", romanized: "" }));
        vocalist.romanized = value;
      }
      else if (tag === "ALBUM_NAME_ROMANIZED") metadata.albumNameRomanized = value;
      else if (tag === "GROUP_NAME") metadata.groupName = value;
      else if (tag === "GROUP_NAME_ROMANIZED") metadata.groupNameRomanized = value;
      else if (tag === "SOURCE_NAME") metadata.sourceName = value;
      else if (tag === "SOURCE_NAME_ROMANIZED") metadata.sourceNameRomanized = value;
      else if (tag === "TAG") {
        const nextTags = value.split(",").map(scalar).filter(Boolean);
        if (nextTags.length > MAX_TAGS) errors.push(documentError(lineNumber, "tag-limit", { count: MAX_TAGS }));
        else metadata.tags = nextTags;
      }
      else if (tag === "GLOBAL_TAGS") metadata.globalTags = value;
      else if (tag === "SONG_LENGTH") metadata.songLength = value;
      else if (tag === "IS_STABLE_TEMPO") {
        if (value !== "True" && value !== "False") errors.push(documentError(lineNumber, "stable-tempo-boolean"));
        else metadata.isStableTempo = value === "True";
      }
      else if (tag === "OFFSET") metadata.offset = value;
      else if (mstructtimeMatch) {
        const number = Number(mstructtimeMatch[1]);
        if (number < 1 || number > MAX_MSTRUCTTIME_FILES) errors.push(documentError(lineNumber, "mstructtime-limit", { count: MAX_MSTRUCTTIME_FILES }));
        else {
          appendIndexed(metadata.mstructtimeFiles, number - 1, () => "");
          metadata.mstructtimeFiles[number - 1] = value;
        }
      }
      else if (REMOVED_RECORDING_FIELDS.has(tag)) {
        // Recording-specific metadata now belongs exclusively to .mstructtime.
        // Historic empty fields are accepted and deliberately dropped on save.
      }
      else metadata.extraFields.push({ tag, value });
    }
  }

  if (commentLines) errors.push(documentError(lines.length, "comments-unclosed"));
  if (metadata.isStableTempo && !/^-?\d+$/.test(metadata.offset)) {
    errors.push(documentError(lines.length, "offset-integer"));
  }
  const timelineFiles = metadata.mstructtimeFiles.filter(Boolean);
  if (new Set(timelineFiles.map((fileName) => fileName.toLocaleLowerCase("en-US"))).size !== timelineFiles.length) {
    errors.push(documentError(lines.length, "mstructtime-duplicate"));
  }
  if (metadata.isStableTempo && timelineFiles.length) {
    errors.push(documentError(lines.length, "stable-tempo-mstructtime"));
  }
  try {
    readProfileIdentity(metadata);
    if (["MSTRUCT_FORMAT_VERSION", "MSTRUCT_PROFILE_ID", "MSTRUCT_PROFILE_HASH"]
      .some((tag) => profileFieldLines.has(tag)) && !metadata.mstructFormatVersion && !metadata.mstructProfileId && !metadata.mstructProfileHash) {
      errors.push(documentError(profileFieldLines.values().next().value, "profile-fields-incomplete"));
    }
  } catch (error) {
    const tag = error.code === "format-version-unsupported" ? "MSTRUCT_FORMAT_VERSION"
      : error.code === "profile-id-invalid" ? "MSTRUCT_PROFILE_ID" : "MSTRUCT_PROFILE_HASH";
    errors.push(documentError(profileFieldLines.get(tag) ?? profileFieldLines.values().next().value ?? 1, error.code, error.details));
  }
  return { metadata: normalizeMetadata(metadata), errors };
}

export function parseMstructDocument(input) {
  const source = String(input ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const envelope = source.match(/^METADATA:\s*\n([\s\S]*?)\nEND_METADATA\s*\n+MAIN:\s*\n([\s\S]*?)\nEND_MAIN(?:\s*\n+COMMENT:\s*\n([\s\S]*?)\nEND_COMMENT)?\s*$/);
  if (!envelope) {
    if (/^(?:METADATA:|END_METADATA|MAIN:|END_MAIN|COMMENT:|END_COMMENT)\s*$/m.test(source)) {
      return {
        ok: false,
        legacy: false,
        metadata: createEmptyMetadata(),
        main: "",
        comments: [],
        errors: [documentError(1, "document-envelope")],
      };
    }
    return { ok: true, legacy: true, metadata: createEmptyMetadata(), main: source, comments: [], errors: [] };
  }
  const parsedMetadata = parseMetadataBlock(envelope[1]);
  const parsedComments = envelope[3] === undefined ? { comments: [], errors: [] } : parseCommentBlock(envelope[3]);
  return {
    ok: parsedMetadata.errors.length === 0 && parsedComments.errors.length === 0,
    legacy: false,
    metadata: parsedMetadata.metadata,
    main: envelope[2].replace(/\n+$/, ""),
    comments: normalizeComments(parsedComments.comments),
    errors: [...parsedMetadata.errors, ...parsedComments.errors],
  };
}
