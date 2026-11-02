// Fixed iframe viewport keeps 1080p CSS geometry independent of HWND limits.
if (window.mstructVideo) {
  const frame = document.querySelector("#videoPresentation");
  window.mstructVideoStage = Object.fromEntries(["initialize", "frame", "audio"].map(name => [name,
    (...args) => frame.contentWindow.mstructVideoStage[name](...args)]));
}
