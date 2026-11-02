import { normalizeMetadata, createMstructFileName } from "../core/mstruct-document.js";
import { getInterfaceLocale, syntaxErrorMessage } from "../editor-i18n.js";
import { setupDesktopVideoExport } from "./desktop-video-export.js";
import { setupVideoExportStage } from "./video-export-stage.js";

/** Coordinate snapshots and the isolated presentation through existing UI ports. */
export function setupEditorVideoExport({ api, tr, profileSession, parse, navigation, display,
  getDocument, getPreferences, getLayers, render, refreshLayout, applySnapshot }) {
  setupDesktopVideoExport({ api, tr, getSnapshot: async () => {
    const document = getDocument(), result = parse(document.main);
    if (!result.ok) throw new Error(syntaxErrorMessage(result.errors[0]));
    return { ...document, metadata: normalizeMetadata(document.metadata), profile: profileSession.profile,
      preferences: getPreferences(), layers: getLayers(), rendererScale: display.getScale(), locale: getInterfaceLocale(),
      suggestedName: createMstructFileName(document.metadata), playback: await navigation().getExportSnapshot() };
  } });
  setupVideoExportStage({ api: window.mstructVideo, navigation, refreshLayout, prepare: async snapshot => {
    const loaded = await profileSession.load(snapshot.metadata, snapshot.profile);
    if (!loaded.ok) throw new Error("videoPlaybackUnavailable");
    applySnapshot(snapshot);
    navigation().handleCommand("fullscreen-view", true); display.setScale(snapshot.rendererScale);
    const result = render();
    navigation().setTimelineDocument(snapshot.playback.timelineDocument);
    navigation().handleCommand("offset", snapshot.playback.temporaryOffset);
    return result;
  } });
}
