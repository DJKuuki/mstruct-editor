import { interfaceCopy } from "./i18n/interface-copy.js";
import { chordErrorCopy, romanErrorCopy } from "./i18n/symbol-error-copy.js";
import { documentErrorCopy, mstructErrorCopy } from "./i18n/diagnostic-copy.js";
export { interfaceCopy, chordErrorCopy, romanErrorCopy, documentErrorCopy, mstructErrorCopy };

export function documentErrorMessage(error, locale = interfaceLocale) {
  const copy = documentErrorCopy[locale === "en" ? "en" : "zh"];
  const template = copy[error.code] ?? copy.generic;
  return Object.entries(error.details ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

let interfaceLocale = "zh";
export function setInterfaceLocale(locale) { interfaceLocale = locale === "en" ? "en" : "zh"; }
export function getInterfaceLocale() { return interfaceLocale; }
export function tr(key, values = {}) {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), interfaceCopy[interfaceLocale][key] ?? key);
}

export function syntaxErrorMessage(error, locale = interfaceLocale) {
  locale = locale === "en" ? "en" : "zh";
  const code = error.domain === "chord" ? error.chordCode : error.domain === "roman" ? error.romanCode : error.code;
  if (error.metadataDomain && documentErrorCopy[locale][code]) return documentErrorMessage(error, locale);
  const copy = error.domain === "chord"
    ? chordErrorCopy[locale]
    : error.domain === "roman"
      ? romanErrorCopy[locale]
      : mstructErrorCopy[locale];
  const template = copy[code] ?? copy.generic;
  const details = { ...(error.details ?? {}) };
  if (code === "missing-initial-bn") {
    details.context = copy[details.context === "after-ellipsis" ? "context-after-ellipsis" : "context-song-start"];
  }
  return Object.entries(details).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}
