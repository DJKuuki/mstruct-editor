/** Native paths stay in the main process; playback consumes the existing File API. */
export function setupDesktopAudioRuntime({ api, context, command }) {
  if (!api?.audioFind) return null;
  let request = 0, contextKey = null, pendingRefresh = null;
  async function load(result, serial) {
    if (serial !== request || result?.cancelled) return;
    command("bgm-clear");
    if (!result?.url) return;
    const response = await fetch(result.url);
    if (!response.ok) return;
    const blob = await response.blob();
    if (serial === request) command("bgm-file", new File([blob], result.name, { type: blob.type }));
  }
  return {
    refresh() {
      const value = context(), key = JSON.stringify([value.stable, value.timeline]);
      if (key === contextKey) return pendingRefresh;
      contextKey = key;
      const serial = ++request;
      command("stop"); command("bgm-clear");
      pendingRefresh = (async () => {
        try { await load(await api.audioFind(value), serial); } catch { /* Missing audio leaves the picker available. */ }
      })();
      return pendingRefresh;
    },
    async choose() { const serial = ++request; command("stop"); await load(await api.audioChoose(context()), serial); },
    clear() { request++; contextKey = null; pendingRefresh = null; command("bgm-clear"); },
  };
}
