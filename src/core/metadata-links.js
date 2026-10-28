export const MAX_SCORE_URLS = 9;
export const MAX_ADDITIONAL_URLS = 9;
export const STANDARD_LINK_FIELDS = [
  ["netease", "URL_NETEASE"],
  ["tme", "URL_TME"],
  ["youtube", "URL_YOUTUBE"],
  ["bilibili", "URL_BILIBILI"],
  ["spotify", "URL_SPOTIFY"],
  ["appleMusic", "URL_APPLE_MUSIC"],
];

const scalar = value => String(value ?? "").replace(/[\r\n]+/g, "").trim();
const emptyUrl = () => ({ label: "", url: "" });

/** One portable link model shared by analysis and recording documents. */
export function normalizeMetadataLinks(value = {}) {
  const scoreUrls = (Array.isArray(value.scoreUrls) ? value.scoreUrls : []).slice(0, MAX_SCORE_URLS).map(scalar);
  const additionalUrls = (Array.isArray(value.additionalUrls) ? value.additionalUrls : []).slice(0, MAX_ADDITIONAL_URLS)
    .map(item => ({ label: scalar(item?.label), url: scalar(item?.url) }));
  return {
    scoreUrls: scoreUrls.length ? scoreUrls : [""],
    links: Object.fromEntries(STANDARD_LINK_FIELDS.map(([key]) => [key, scalar(value.links?.[key])])),
    additionalUrls: additionalUrls.length ? additionalUrls : [emptyUrl()],
  };
}

export function serializeScoreLinks(value) {
  return normalizeMetadataLinks(value).scoreUrls.map((url, index) => `{SCORE_URL_${index + 1}}${url}`);
}

export function serializeExternalLinks(value) {
  const metadata = normalizeMetadataLinks(value);
  return [
    ...STANDARD_LINK_FIELDS.map(([key, tag]) => `{${tag}}${metadata.links[key]}`),
    ...metadata.additionalUrls.filter(item => item.label || item.url)
      .map((item, index) => `{URL_ADDITIONAL_${index + 1}:${item.label}}${item.url}`),
  ];
}

/** Returns null for other metadata, or a handled result with an optional diagnostic. */
export function readMetadataLink(metadata, tag, value) {
  const standard = STANDARD_LINK_FIELDS.find(([, field]) => field === tag);
  if (standard) { metadata.links[standard[0]] = value; return {}; }
  const score = /^SCORE_URL_(\d+)$/.exec(tag);
  const additional = /^URL_ADDITIONAL(?:_(\d+))?:(.+)$/.exec(tag);
  if (!score && !additional) return null;
  const items = score ? metadata.scoreUrls : metadata.additionalUrls;
  const firstEmpty = items.findIndex(item => !item.label && !item.url);
  const number = Number(score ? score[1] : additional[1] || (firstEmpty >= 0 ? firstEmpty + 1 : items.length + 1));
  const maximum = score ? MAX_SCORE_URLS : MAX_ADDITIONAL_URLS;
  if (number < 1 || number > maximum) return { code: score ? "score-url-limit" : "additional-url-limit", details: { count: maximum } };
  while (items.length < number) items.push(score ? "" : emptyUrl());
  items[number - 1] = score ? value : { label: additional[2].trim(), url: value };
  return {};
}
