/** Native paths stay in the main process; playback consumes the existing File API. */
export function setupDesktopAudioRuntime({ api, context, command }) {
  if (!api?.audioFind) return null;
  let request = 0;
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
    async refresh() { const serial = ++request; command("stop"); command("bgm-clear"); try { await load(await api.audioFind(context()), serial); } catch { /* Missing audio leaves the picker available. */ } },
    async choose() { const serial = ++request; command("stop"); await load(await api.audioChoose(context()), serial); },
    clear() { request++; command("bgm-clear"); },
  };
}
