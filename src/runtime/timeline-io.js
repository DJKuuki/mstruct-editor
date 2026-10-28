export function createTimelineIo({ desktopApi, hostedMode, isHostedViewer, postToHost, setDirty, getParentFileName }) {
  let requestNumber = 0;
  const pendingRequests = new Map();

  function request(action, payload = {}) {
    if (!hostedMode || isHostedViewer) return Promise.resolve({ ok: false });
    const requestId = `timeline-${Date.now()}-${requestNumber += 1}`;
    return new Promise((resolve) => {
      pendingRequests.set(requestId, resolve);
      postToHost("timeline-action", { requestId, action, ...payload });
    });
  }

  return {
    io: {
      setDirty,
      parentFileName: getParentFileName,
      open: desktopApi?.openTimeline ? () => desktopApi.openTimeline() : undefined,
      create: (payload) => desktopApi?.createTimeline
        ? desktopApi.createTimeline(payload)
        : hostedMode ? request("create", payload) : Promise.resolve(payload),
      save: (payload) => desktopApi?.saveTimeline
        ? desktopApi.saveTimeline(payload)
        : hostedMode ? request("save", payload) : Promise.resolve({ ok: true }),
      saveAs: desktopApi?.saveTimelineAs ? (payload) => desktopApi.saveTimelineAs(payload) : undefined,
      remove: (payload) => desktopApi?.removeTimeline
        ? desktopApi.removeTimeline(payload)
        : hostedMode ? request("remove", payload) : Promise.resolve({ ok: true }),
      history: (payload) => postToHost("timeline-history", payload),
    },
    handleMessage(data) {
      if (data?.type !== "timeline-action-result") return false;
      const resolve = pendingRequests.get(data.requestId);
      if (!resolve) return false;
      pendingRequests.delete(data.requestId);
      resolve(data.result ?? { ok: false, message: data.message });
      return true;
    },
  };
}

export async function loadDesktopTimelineFiles({ desktopApi, fileNames, onFiles, onMissing }) {
  if (!desktopApi?.loadTimelines) return;
  const result = await desktopApi.loadTimelines(fileNames);
  const files = result?.files ?? [];
  onFiles(files);
  const missing = files.filter((item) => item.missing).map((item) => item.fileName);
  if (missing.length) onMissing(missing);
}
