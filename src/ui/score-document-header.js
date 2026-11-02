import { normalizeMetadata } from "../core/mstruct-document.js";
import { tagIsVisible } from "../core/renderer-layers.js";

/** Shared screen/export header construction; the entry point supplies state. */
export function createScoreDocumentHeader({ makeElement, tr, makeTagLabel, getMetadata, getLayers }) {
  return {
    renderDocumentHeader(documentMetadata = getMetadata()) {
      const normalized = normalizeMetadata(documentMetadata);
      const composers = normalized.composers.map(composer => composer.name).filter(Boolean);
      if (!normalized.songName && !composers.length) return null;
      const header = makeElement("header", "score-document-header");
      if (normalized.songName) header.append(makeElement("h2", "score-document-title", normalized.songName));
      if (composers.length) header.append(makeElement("p", "score-document-composers", composers.join(", ")));
      return header;
    },
    renderGlobalTags(tags) {
      const visible = tags?.filter(tag => tagIsVisible(tag, getLayers())) ?? [];
      if (!visible.length) return null;
      const section = makeElement("section", "score-global-tags");
      section.append(makeElement("h3", "score-global-tags-title", tr("globalTagsLabel")));
      const list = makeElement("div", "score-global-tags-list");
      visible.forEach(tag => list.append(makeTagLabel(tag, "tag-label tag-oneshot")));
      section.append(list);
      return section;
    },
  };
}
