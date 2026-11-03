import { setupDesktopLibrary } from "./desktop-library.js";
import { setupDesktopAudioRuntime } from "./desktop-audio.js";
import { loadDesktopTimelineFiles } from "./timeline-io.js";
import { setupDesktopTransition } from "./desktop-transition.js";

/** Coordinate native document navigation, library visibility and recording context. */
export function setupDesktopWorkspace({ api, profiles, locale, session, renderer, audioContext, clearDirty, refreshLayout, onTimelines, onMissingTimelines, errorMessage,
  isAnalysisDirty, isTimelineDirty, saveTimeline }) {
  if (!api) return null;
  setupDesktopTransition({ api, session, isAnalysisDirty, isTimelineDirty, saveTimeline });
  const command = (name, value) => renderer()?.handleCommand(name, value);
  const audio = setupDesktopAudioRuntime({ api, context: audioContext, command });
  const library = setupDesktopLibrary({ api, profiles, locale, session, onLeave: clearDirty, onOpen: refreshLayout,
    stopPlayback: () => { command("stop"); audio.clear(); }, search: value => command("search-set", value), errorMessage });
  const timelines = fileNames => loadDesktopTimelineFiles({ desktopApi: api, fileNames, onFiles: onTimelines, onMissing: onMissingTimelines });
  return {
    get browsing() { return library.visible; },
    start: () => library.start(), refreshLocale: () => library.refreshLocale(),
    newDocument() { audio.clear(); library.opened(); },
    async opened(fileNames) { audio.clear(); await timelines(fileNames); library.opened(); await audio.refresh(); },
    saved: () => library.saved(),
    refreshAudio: () => audio.refresh(), chooseAudio: media => audio.choose(media),
  };
}
