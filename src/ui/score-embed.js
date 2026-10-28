import { compileMstructScore, scoreDiagnosticMessage } from "../core/score-embed.js";
import { layoutSystems } from "../core/engraving.js";
import { alignScoreBarlines } from "./score-barlines.js";
import { parseFraction } from "../core/mstruct-rational.js";
import { normalizeRendererPreferences } from "../core/renderer-preferences.js";
import { normalizeRendererLayers, tagIsVisible } from "../core/renderer-layers.js";
import { interfaceCopy } from "../editor-i18n.js";
import { createSymbolUi } from "./symbol-ui.js";
import { createScoreRenderer } from "./score-renderer.js";
import { createCommentPopover } from "./comment-popover.js";
import { renderInlineMusicText } from "./inline-music.js";
import { makeDurationNotes } from "./duration-label.js";
import { createTempoLabels } from "./tempo-label.js";

let nextEmbedId = 0;

/** Mount a score without a tool shell, file adapter, navigation or playback. */
export function mountMstructScore(element, source, options = {}) {
  const doc = element.ownerDocument;
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  let currentSource = source;
  let currentOptions = options;
  let preferences = normalizeRendererPreferences(options.preferences);
  let result;
  let destroyed = false;
  let layoutFrame = null;
  let lastWidth = -1;
  const abort = new AbortController();
  const listen = (target, type, fn, extra = {}) => target.addEventListener(type, fn, { ...extra, signal: abort.signal });
  const makeElement = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const tr = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), interfaceCopy[currentOptions.locale === "en" ? "en" : "zh"][key] ?? key);
  const style = makeElement("style");
  style.textContent = `${options.styles ?? ""}\n:host { display: block; min-width: 0; --ink: #19221f; --muted: #718079; --line: #dfe7e1; --score-font-size: 16px; font: 16px Arial, sans-serif; color: var(--ink); text-align: left; } .renderer-canvas { padding: 12px 12px 24px; overflow-x: auto; overflow-y: hidden; background: transparent; }`;
  const canvas = makeElement("div", "renderer-canvas");
  root.replaceChildren(style, canvas);
  const id = `mstruct-embed-${++nextEmbedId}`;
  const refs = {};
  function dialog(kind, title, closeLabel) {
    const dialog = makeElement("dialog", `${kind}-popover`);
    dialog.id = `${id}-${kind}`;
    const header = makeElement("header", `${kind}-popover-header`);
    const heading = makeElement("h2", null, title);
    heading.id = `${dialog.id}-heading`;
    dialog.setAttribute("aria-labelledby", heading.id);
    const close = makeElement("button", `${kind}-popover-close`, "×");
    close.type = "button";
    close.setAttribute("aria-label", closeLabel);
    header.append(heading, close);
    dialog.append(header);
    root.append(dialog);
    return { dialog, heading, close };
  }
  function field(parent, tag, className, name, text) {
    const node = makeElement(tag, className, text);
    refs[name] = node;
    parent.append(node);
    return node;
  }
  const chord = dialog("chord", tr("chordDetails"), tr("closeChordDetails"));
  const chordSymbol = field(chord.heading, "span", null, "chordPopoverSymbol");
  const chordBody = makeElement("div", "chord-popover-body");
  const details = makeElement("dl", "chord-popover-results");
  for (const [key, name] of [["chordIntervalQuality", "chordPopoverIntervals"], ["chordNoteNames", "chordPopoverNoteNames"]]) {
    const row = makeElement("div");
    row.append(makeElement("dt", null, tr(key)));
    field(row, "dd", null, name);
    details.append(row);
  }
  chordBody.append(details);
  const staff = makeElement("figure", "chord-popover-staff");
  staff.append(makeElement("figcaption", null, tr("chordStaff")));
  field(staff, "div", "chord-popover-staff-canvas", "chordPopoverStaff").setAttribute("role", "img");
  field(staff, "p", "chord-popover-message", "chordPopoverStaffError", tr("chordStaffFailed")).hidden = true;
  chordBody.append(staff);
  chord.dialog.append(chordBody);
  const footer = makeElement("footer", "chord-popover-footer");
  field(footer, "p", "chord-popover-message", "chordPopoverAudioError", tr("chordAudioFailed")).hidden = true;
  const play = field(footer, "button", "chord-popover-play", "chordPopoverPlay");
  play.type = "button";
  field(play, "span", null, "chordPopoverPlayLabel", tr("playChord"));
  chord.dialog.append(footer);
  const roman = dialog("roman", tr("romanDetails"), tr("closeRomanDetails"));
  field(roman.heading, "span", null, "romanPopoverSymbol");
  const romanDetails = makeElement("dl", "roman-popover-results");
  romanDetails.append(makeElement("dt", null, tr("romanStructure")));
  field(romanDetails, "dd", null, "romanPopoverStructure");
  roman.dialog.append(romanDetails);
  const comment = dialog("comment", "COMMENT", tr("closeComment"));
  const language = makeElement("p", "comment-popover-language");
  const commentBody = makeElement("p", "comment-popover-body");
  comment.dialog.append(language, commentBody);
  const symbols = createSymbolUi({ ...refs, chordPopover: chord.dialog, chordPopoverSymbol: chordSymbol, romanPopover: roman.dialog, makeElement, getChordPreferences: () => preferences, getHostedPopoverDocument: () => null, pianoOptions: options.pianoOptions, tr });
  const comments = createCommentPopover({ dialog: comment.dialog, closeButton: comment.close, heading: comment.heading, languageLabel: language, body: commentBody, getComments: () => result?.comments ?? [], getLocale: () => currentOptions.locale, getHostedPopoverDocument: () => null, renderCommentText: (target, text) => renderInlineMusicText(target, text, { ...currentOptions, renderMode: preferences.renderMode }), tr });
  const layers = normalizeRendererLayers();
  const tempo = createTempoLabels({ makeElement, makeDurationNotes, parseFraction, tr });
  const renderer = createScoreRenderer({
    ...symbols, ...tempo, ...comments, makeElement, tr,
    getChordPreferences: () => preferences, getRendererLayers: () => layers, getLocale: () => currentOptions.locale,
    makeTimeSignature(value) {
      const signature = makeElement("span", "time-signature");
      const values = makeElement("span", "time-signature-values");
      if (value === "adlib") { signature.classList.add("is-adlib"); values.append(makeElement("span", "time-signature-adlib", "ad lib.")); }
      else { const [top, bottom] = value.split("/"); values.append(makeElement("span", "time-signature-top", top), makeElement("span", "time-signature-bottom", bottom)); }
      signature.append(values);
      return signature;
    },
  });
  const close = () => { symbols.closeChordPopover(); symbols.closeRomanPopover(); comments.closeCommentPopover(); };
  listen(chord.close, "click", symbols.closeChordPopover);
  listen(roman.close, "click", symbols.closeRomanPopover);
  listen(play, "click", async () => {
    const current = symbols.getCurrentChordPopover();
    if (!current || play.disabled) return;
    play.disabled = true;
    refs.chordPopoverPlayLabel.textContent = tr("loadingPiano");
    try { await symbols.chordPianoPlayer.play(current.midiNotes); }
    catch { if (!destroyed) refs.chordPopoverAudioError.hidden = false; }
    finally { if (destroyed) symbols.chordPianoPlayer.dispose(); else { play.disabled = false; refs.chordPopoverPlayLabel.textContent = tr("playChord"); } }
  });
  listen(doc, "pointerdown", (event) => {
    const path = event.composedPath();
    if (![chord.dialog, roman.dialog, comment.dialog].some((node) => path.includes(node))) close();
  });
  listen(root, "click", (event) => { if (event.target.closest?.(".chord-trigger,.roman-trigger,.comment-icon,.comment-range-segment")) close(); }, { capture: true });
  listen(doc, "keydown", (event) => { if (event.key === "Escape") close(); });
  listen(doc, "scroll", close, { capture: true });
  listen(canvas, "scroll", close);
  function draw() {
    if (destroyed) return;
    close();
    canvas.replaceChildren();
    lastWidth = element.clientWidth;
    if (!result.ok) {
      const errors = makeElement("section", "render-error");
      errors.append(makeElement("h3", null, tr("renderFailed")));
      const list = makeElement("ol", "error-list");
      for (const error of result.errors) list.append(makeElement("li", null, `${tr("line", { count: error.line })}: ${scoreDiagnosticMessage(result, error, currentOptions.locale)}`));
      errors.append(list);
      canvas.append(errors);
      return;
    }
    const systems = layoutSystems(result.flow, Math.max(240, lastWidth - 24), { preferences, durationDisplayMode: preferences.durationDisplayMode, locale: currentOptions.locale, layers });
    const chart = makeElement("div", "chart");
    systems.forEach((system) => chart.append(renderer.renderSystem(system)));
    renderer.markEndingSystems(chart, result);
    if (!chart.childElementCount) chart.append(makeElement("p", "incomplete-note", tr("incomplete")));
    if (result.metadata.songName) {
      const header = makeElement("header", "score-document-header");
      header.append(makeElement("h2", "score-document-title", result.metadata.songName));
      const composers = result.metadata.composers.map((person) => person.name).filter(Boolean);
      if (composers.length) header.append(makeElement("p", "score-document-composers", composers.join(", ")));
      canvas.append(header);
    }
    const globalTags = result.globalTags?.filter(tag => tagIsVisible(tag, layers)) ?? [];
    if (globalTags.length) {
      const section = makeElement("section", "score-global-tags");
      section.append(makeElement("h3", "score-global-tags-title", tr("globalTagsLabel")));
      const list = makeElement("div", "score-global-tags-list");
      globalTags.forEach((tag) => list.append(renderer.makeTagLabel(tag, "tag-label tag-oneshot")));
      section.append(list);
      canvas.append(section);
    }
    canvas.append(chart);
    alignScoreBarlines(chart);
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      if (destroyed || !chart.isConnected) return;
      renderer.drawRomanVoiceLeadingLines(chart);
      renderer.drawNewRiemannianConnections(chart);
      renderer.drawTagRangeLines(chart);
      renderer.drawCommentRangeLines(chart);
      renderer.drawEndingBrackets(chart, result);
    });
  }
  function update(nextSource = currentSource, nextOptions = currentOptions) {
    currentSource = nextSource;
    currentOptions = nextOptions;
    preferences = normalizeRendererPreferences(nextOptions.preferences);
    result = compileMstructScore(currentSource, currentOptions);
    draw();
    return result;
  }
  const observer = new ResizeObserver(() => { if (Math.abs(element.clientWidth - lastWidth) >= 1) draw(); });
  observer.observe(element);
  void doc.fonts?.ready.then(() => { if (!destroyed) draw(); });
  update();
  return {
    update,
    destroy() {
      destroyed = true;
      abort.abort();
      observer.disconnect();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      close();
      symbols.chordPianoPlayer.dispose();
      root.replaceChildren();
    },
  };
}
