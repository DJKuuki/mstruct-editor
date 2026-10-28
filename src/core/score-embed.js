import { parseMstruct } from "./mstruct.js";
import { createEmptyMetadata, parseMstructDocument } from "./mstruct-document.js";
import { parseGlobalTagList } from "./semantic-tags.js";
import { documentErrorMessage, syntaxErrorMessage } from "../editor-i18n.js";

// Embedding only chooses an envelope; all music semantics remain in the compiler.
/** @param {string} source @param {{sourceKind?: string, specialChords?: any, romanConfig?: any, tagConfig?: any, semanticTagConfig?: any, formTagConfig?: any}} options */
export function compileMstructScore(source, { sourceKind = "main", ...config } = {}) {
  const text = String(source ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let document;
  if (sourceKind === "document") {
    document = parseMstructDocument(text);
    if (document.legacy) document = { ...document, ok: false, errors: [{ code: "document-envelope", line: 1, details: {} }] };
  } else if (sourceKind === "main") {
    const envelope = text.match(/^MAIN:\s*\n([\s\S]*?)\nEND_MAIN\s*$/);
    document = { ok: true, metadata: createEmptyMetadata(), comments: [], main: envelope ? envelope[1] : text, errors: [] };
  } else {
    throw new TypeError("Unsupported MStruct score source kind.");
  }
  if (!document.ok) return { ...document, documentErrors: true };
  const global = parseGlobalTagList(document.metadata.globalTags, config);
  const result = parseMstruct(document.main, {
    ...config, comments: document.comments,
    isStableTempo: document.metadata.isStableTempo, globalTags: global.tags,
  });
  return { ...result, ok: result.ok && global.errors.length === 0, errors: [...result.errors, ...global.errors], globalTags: global.tags, metadata: document.metadata, comments: document.comments, documentErrors: false };
}

export function scoreDiagnosticMessage(result, error, locale) {
  return result.documentErrors ? documentErrorMessage(error, locale) : syntaxErrorMessage(error, locale);
}
