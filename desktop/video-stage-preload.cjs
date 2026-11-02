const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("mstructVideo", Object.freeze({
  pianoInstrumentUrl: "mstruct-app://renderer/__desktop_assets__/soundfonts/acoustic_grand_piano-ogg.js",
  ready: () => ipcRenderer.send("mstruct-video:stage-ready"),
  writeAudio: bytes => ipcRenderer.invoke("mstruct-video:audio", bytes),
}));
