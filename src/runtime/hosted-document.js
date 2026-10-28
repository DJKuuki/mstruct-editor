import { normalizeMetadata } from "../core/mstruct-document.js";
import { normalizeComments } from "../core/mstruct-comments.js";
import { documentErrorMessage } from "../editor-i18n.js";
import { MstructProfileError, readProfileIdentity } from "../core/profile-schema.js";

/** Importing text into a bound draft must not relabel another build's document. */
export function validateHostedImportIdentity(imported, current) {
  const identity = readProfileIdentity(imported), binding = readProfileIdentity(current);
  if (identity && (!binding || identity.profileId !== binding.profileId || identity.bundleHash !== binding.bundleHash)) {
    throw new MstructProfileError("profile-identity-mismatch");
  }
}

/** Hosted initialization validates a whole package before committing document UI. */
export function createHostedDocumentInitializer({ profileSession, isViewer, controls, applyLocale, applyPreferences, applyRendererScale, applySearchVocabulary,
  replaceDocument, render, navigation, timelines, markSaved, post, status, openInitialMetadata }) {
  let initialSetupHandled = false;
  return async (payload) => {
    applyLocale(payload?.locale);
    const metadata = normalizeMetadata(payload?.metadata), comments = normalizeComments(payload?.comments);
    const prepared = await profileSession.load(metadata, payload?.profile);
    if (prepared.cancelled) return;
    if (prepared.ok) applySearchVocabulary?.(payload?.searchVocabulary, metadata);
    applyPreferences(payload?.chordPreferences);
    applyRendererScale?.(payload?.rendererScale);
    replaceDocument({ metadata, comments, lockedMetadata: Boolean(payload?.lockedMetadata) });
    controls.sourceInput.value = String(payload?.main ?? "");
    controls.sourceInput.disabled = isViewer || !prepared.ok;
    controls.metadataButton.disabled = isViewer || !prepared.ok;
    controls.commentsButton.disabled = isViewer || !prepared.ok;
    controls.editorSettingsButton.disabled = isViewer;
    controls.newButton.hidden = true;
    for (const name of ["importButton", "exportButton", "renderButton", "saveDraftButton", "discardDraftButton", "submitAnalysisButton"]) controls[name].hidden = isViewer;
    for (const name of ["importButton", "saveDraftButton", "submitAnalysisButton"]) controls[name].disabled = !prepared.ok;
    controls.toolbox.inert = !prepared.ok;
    document.body.classList.add("host-ready");
    render();
    if (!prepared.ok) status(documentErrorMessage(prepared.error), false);
    if (String(payload?.technique ?? "").trim()) navigation()?.handleCommand("search-set", payload.technique);
    else navigation()?.handleCommand("search-clear");
    timelines()?.setFiles(payload?.timelines ?? [], payload?.selectedTimeline ?? "");
    markSaved();
    post("ready", { metadata, comments });
    post("profile-status", { ok: prepared.ok });
    if (prepared.ok && payload?.initialAnalysisSetup === true && !isViewer && !initialSetupHandled) {
      initialSetupHandled = true;
      openInitialMetadata();
    }
  };
}
