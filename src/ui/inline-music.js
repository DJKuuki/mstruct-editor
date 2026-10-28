import { inlineMusicModel, parseInlineMusicText } from "../core/inline-music.js";
import { symbolModelDom } from "./symbol-dom.js";

export function renderInlineMusicText(target, text, options = {}) {
  const ownerDocument = target.ownerDocument;
  target.replaceChildren(...parseInlineMusicText(text).map((part) => part.kind === "text"
    ? ownerDocument.createTextNode(part.text)
    : symbolModelDom(inlineMusicModel(part, options).model, ownerDocument)));
}
