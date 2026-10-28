export const APPLICATION_COLOR_SCHEMES = Object.freeze(["ink-blue", "green", "terracotta"]);
export const DEFAULT_APPLICATION_COLOR_SCHEME = "ink-blue";
export const APPLICATION_COLOR_SCHEME_STORAGE_KEY = "mstruct-application-color-scheme";

export function isApplicationColorScheme(value) {
  return APPLICATION_COLOR_SCHEMES.includes(value);
}

export function normalizeApplicationColorScheme(value) {
  return isApplicationColorScheme(value) ? value : DEFAULT_APPLICATION_COLOR_SCHEME;
}
