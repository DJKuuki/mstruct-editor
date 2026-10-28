/** Save timeline edits before an analysis save can reload the linked timeline files. */
export function setupDesktopTransition({ api, session, isAnalysisDirty, isTimelineDirty, saveTimeline }) {
  if (!api?.onSaveBeforeTransition) return;
  let saving = false;
  api.onSaveBeforeTransition(async token => {
    let saved = false;
    if (!saving) {
      saving = true;
      try {
        const timelineSaved = !isTimelineDirty() || await saveTimeline() === true;
        const analysisSaved = timelineSaved && (!isAnalysisDirty() || await session().save() === true);
        saved = analysisSaved && !isAnalysisDirty() && !isTimelineDirty();
      } catch { saved = false; }
      finally { saving = false; }
    }
    await api.completeTransitionSave({ token, saved }).catch(() => {});
  });
}
