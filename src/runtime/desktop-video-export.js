import "../ui/video-export.css";

/** Desktop-only workflow. Source and playback snapshots are supplied by the UI. */
export function setupDesktopVideoExport({ api, tr, getSnapshot }) {
  if (!api?.startVideoExport) return null;
  const dialog = document.createElement("dialog");
  dialog.className = "video-export-dialog";
  const title = document.createElement("h2"), description = document.createElement("p");
  const progress = document.createElement("progress"); progress.max = 100; progress.value = 0;
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const actions = document.createElement("footer");
  const cancel = document.createElement("button"), start = document.createElement("button");
  for (const button of [cancel, start]) button.type = "button";
  actions.append(cancel, start); dialog.append(title, description, progress, status, actions); document.body.append(dialog);
  let running = false;
  const refresh = () => {
    title.textContent = tr("videoExportTitle"); description.textContent = tr("videoExportDescription");
    cancel.textContent = tr(running ? "videoCancelExport" : "cancel"); start.textContent = tr("videoExportStart");
  };
  const stop = () => { if (running) void api.cancelVideoExport(); else dialog.close(); };
  cancel.addEventListener("click", stop);
  dialog.addEventListener("cancel", event => { event.preventDefault(); stop(); });
  api.onVideoProgress(value => {
    if (!running) return;
    progress.value = value.percent;
    status.textContent = tr(value.phase === "audio" ? "videoRenderingAudio" : value.phase === "encoding" ? "videoEncoding" : "videoRenderingFrames", { percent: Math.floor(value.percent) });
  });
  start.addEventListener("click", async () => {
    if (running) return;
    running = true; start.disabled = true; progress.value = 0; refresh(); status.textContent = tr("videoPreparing");
    try {
      const snapshot = await getSnapshot();
      const { bgmFile, ...playback } = snapshot.playback;
      const bgm = bgmFile ? { name: bgmFile.name, bytes: await bgmFile.arrayBuffer() } : null;
      const result = await api.startVideoExport({ ...snapshot, playback, bgm });
      progress.value = result.cancelled ? 0 : 100;
      status.textContent = tr(result.cancelled ? "videoExportCancelled" : "videoExportComplete", { path: result.path });
    } catch (error) { status.textContent = `${tr("videoExportFailed")} ${tr(error.message)}`; }
    finally { running = false; start.disabled = false; refresh(); }
  });
  api.onCommand(command => {
    if (command !== "export:mp4" || dialog.open) return;
    refresh(); progress.value = 0; status.textContent = tr("videoExportAudioHelp"); dialog.showModal();
  });
  return { close: stop };
}
