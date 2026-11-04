const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const { mkdtemp, open, writeFile, rename, rm } = require("node:fs/promises");
const path = require("node:path");
const { WIDTH, HEIGHT, FPS, SAMPLE_RATE, videoEncodingArguments } = require("./video-encoding.cjs");

function validateSnapshot(value) {
  if (!value || typeof value.main !== "string" || value.main.length > 16 * 1024 * 1024 || !value.metadata || !value.profile || !value.playback) throw new Error("Invalid video export snapshot.");
  if (JSON.stringify({ ...value, bgm: undefined }).length > 48 * 1024 * 1024) throw new Error("Video export snapshot is too large.");
  if (value.bgm && (!(value.bgm.bytes instanceof ArrayBuffer) || value.bgm.bytes.byteLength > 512 * 1024 * 1024 || !/\.(mp4|mp3|wav)$/i.test(value.bgm.name))) throw new Error("Invalid video audio.");
  if (value.playback.presentationMode !== undefined && !["default", "scroll", "video"].includes(value.playback.presentationMode)) throw new Error("Invalid video presentation mode.");
  if (value.fps !== undefined && value.fps !== 30 && value.fps !== 60) throw new Error("Invalid video frame rate.");
  if (!Number.isFinite(value.playback.bgmVolume) || value.playback.bgmVolume < 0 || value.playback.bgmVolume > 100) throw new Error("Invalid video audio volume.");
}

/** One isolated, bounded export job. The renderer never supplies native paths. */
function setupVideoExport({ ipcMain, BrowserWindow, dialog, app, getWindow, assertTrustedSender, assetsRoot, captureTiles }) {
  let active = null;
  const progress = (job, phase, percent) => {
    if (!job.owner.isDestroyed()) job.owner.send("mstruct-video:progress", { phase, percent });
  };
  const check = job => { if (job.cancelled) throw new Error("videoExportCancelled"); };
  const wait = (job, promise) => Promise.race([promise, job.aborted]);
  function cancel() {
    if (!active) return;
    active.cancelled = true;
    active.process?.kill();
    // Let an in-flight Chromium capture settle before destroying its window.
    // Destroying an offscreen frame during capture can deadlock native teardown.
    active.rejectReady?.(new Error("videoExportCancelled"));
  }
  ipcMain.on("mstruct-video:stage-ready", event => {
    if (active?.window?.webContents === event.sender) active.resolveReady?.();
  });
  ipcMain.handle("mstruct-video:audio", async (event, bytes) => {
    const job = active;
    if (!job || job.window?.webContents !== event.sender || !job.audio || !(bytes instanceof ArrayBuffer) || bytes.byteLength > SAMPLE_RATE * 20 * 8 || bytes.byteLength % 8) throw new Error("Invalid video audio chunk.");
    check(job);
    if (job.audioBytes + bytes.byteLength > job.expectedAudioBytes) throw new Error("Video audio exceeded its declared length.");
    await job.audio.writeFile(Buffer.from(bytes)); job.audioBytes += bytes.byteLength;
    progress(job, "audio", 15 * job.audioBytes / job.expectedAudioBytes);
  });
  ipcMain.handle("mstruct-video:cancel", event => { assertTrustedSender(event); cancel(); });
  async function start(event, snapshot) {
    assertTrustedSender(event); validateSnapshot(snapshot);
    if (active) throw new Error("videoExportBusy");
    const job = { owner: event.sender, cancelled: false, audioBytes: 0 };
    job.aborted = new Promise((_resolve, reject) => { job.abort = reject; });
    job.aborted.catch(() => {});
    active = job;
    try {
      const result = await dialog.showSaveDialog(getWindow(), {
        title: snapshot.locale === "en" ? "Export MP4 Video" : "导出 MP4 视频",
        defaultPath: String(snapshot.suggestedName || "MStruct").replace(/\.mstruct$/i, "") + ".mp4",
        filters: [{ name: "MP4", extensions: ["mp4"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      check(job);
      const target = /\.mp4$/i.test(result.filePath) ? result.filePath : `${result.filePath}.mp4`;
      job.directory = await mkdtemp(path.join(path.dirname(target), ".mstruct-video-"));
      const output = path.join(job.directory, "video.mp4");
      const executable = path.join(assetsRoot(), "video-encoder", "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
      let bgmPath, pianoPath;
      if (snapshot.bgm) {
        bgmPath = path.join(job.directory, `music${path.extname(snapshot.bgm.name).toLowerCase()}`);
        await writeFile(bgmPath, Buffer.from(snapshot.bgm.bytes));
        if (/\.mp4$/i.test(snapshot.bgm.name)) {
          if (snapshot.playback.presentationMode === "video") {
            job.mediaToken = randomUUID();
            job.mediaBytes = snapshot.bgm.bytes;
          }
          try {
            await promisify(execFile)(executable, ["-hide_banner", "-nostdin", "-i", bgmPath, "-map", "0:a:0?", "-vn", "-t", "0.001", "-f", "null", "-"], { windowsHide: true, timeout: 15000 });
          } catch (error) {
            if (/does not contain any stream/.test(error.stderr ?? "")) bgmPath = undefined;
            else throw error;
          }
        }
      }
      check(job);
      const ready = new Promise((resolve, reject) => { job.resolveReady = resolve; job.rejectReady = reject; });
      // Observe rejection immediately, including cancellation while loadURL waits.
      ready.catch(() => {});
      const timer = setTimeout(() => job.rejectReady(new Error("Video presentation did not become ready.")), 60000);
      job.window = new BrowserWindow({ width: 1024, height: 768, show: false, frame: false,
        webPreferences: { preload: path.join(__dirname, "video-stage-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false,
          backgroundThrottling: false, offscreen: { deviceScaleFactor: 1 } } });
      const contents = job.window.webContents;
      contents.setAudioMuted(true); contents.setZoomFactor(1); contents.setFrameRate(240);
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (navigation, url) => { if (url !== "mstruct-app://renderer/video-capture.html") navigation.preventDefault(); });
      contents.on("render-process-gone", () => { const error = new Error("Video presentation process exited."); job.rejectReady(error); job.abort(error); });
      try { await job.window.loadURL("mstruct-app://renderer/video-capture.html"); await ready; }
      finally { clearTimeout(timer); }
      check(job);
      const { bgm, mediaUrl, ...presentation } = snapshot;
      if (job.mediaToken) presentation.mediaUrl = `mstruct-app://renderer/__video_media__/${job.mediaToken}`;
      const model = await wait(job, contents.executeJavaScript(`window.mstructVideoStage.initialize(${JSON.stringify(presentation)})`));
      const fps = snapshot.fps ?? FPS;
      const [viewportWidth, viewportHeight] = job.window.getContentSize();
      if (model.width !== WIDTH || model.height !== HEIGHT || model.fps !== fps || !Number.isSafeInteger(model.frameCount) || model.frameCount < 1 || model.frameCount > 6 * 3600 * fps) throw new Error("Invalid video geometry or duration.");
      if (model.hasPiano) {
        pianoPath = path.join(job.directory, "piano.f32");
        job.audio = await open(pianoPath, "w");
        job.expectedAudioBytes = Math.ceil(model.frameCount / fps * SAMPLE_RATE) * 8;
        try { await wait(job, contents.executeJavaScript("window.mstructVideoStage.audio()")); }
        finally { await job.audio.close(); job.audio = null; }
        if (job.audioBytes !== job.expectedAudioBytes) throw new Error("Video piano audio was incomplete.");
      }
      check(job);
      const args = videoEncodingArguments({ frameCount: model.frameCount, fps, bgmPath, pianoPath, bgmVolume: snapshot.playback.bgmVolume, output });
      job.process = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      let diagnostics = "";
      job.process.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-6000); });
      job.process.stdin.on("error", () => {});
      const finished = new Promise((resolve, reject) => {
        job.process.once("error", reject);
        job.process.once("close", code => code === 0 ? resolve() : reject(new Error(`videoEncoderFailed: ${diagnostics}`)));
      });
      finished.catch(() => {});
      for (let frame = 0; frame < model.frameCount; frame++) {
        check(job);
        await wait(job, contents.executeJavaScript(`window.mstructVideoStage.frame(${frame})`));
        check(job);
        const image = await wait(job, captureTiles(contents, { width: WIDTH, height: HEIGHT }, { width: viewportWidth, height: viewportHeight }, false, { verifyPaint: true }));
        check(job);
        const size = image.getSize();
        if (size.width !== WIDTH || size.height !== HEIGHT) throw new Error(`Video frame was captured at ${size.width}x${size.height}; content ${job.window.getContentSize().join("x")}.`);
        const bitmap = image.toBitmap({ scaleFactor: 1 });
        if (bitmap.byteLength !== WIDTH * HEIGHT * 4) throw new Error("Video frame was incomplete.");
        await wait(job, new Promise((resolve, reject) => job.process.stdin.write(bitmap, error => error ? reject(error) : resolve())));
        if (frame % fps === 0) progress(job, "frames", 15 + 80 * frame / model.frameCount);
      }
      job.process.stdin.end(); progress(job, "encoding", 96);
      await wait(job, finished); check(job);
      await rename(output, target);
      progress(job, "encoding", 100);
      return { cancelled: false, path: target };
    } catch (error) {
      if (job.cancelled) return { cancelled: true };
      throw error;
    } finally {
      job.process?.kill();
      if (job.window && !job.window.isDestroyed()) job.window.destroy();
      if (job.directory) await rm(job.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (active === job) active = null;
    }
  }
  ipcMain.handle("mstruct-video:start", start);
  app.on("before-quit", cancel);
  return { cancel,
    response(token) {
      if (!active?.mediaToken || token !== active.mediaToken || active.cancelled) return new Response("Not found", { status: 404 });
      return new Response(active.mediaBytes, { headers: { "content-type": "video/mp4" } });
    },
  };
}

module.exports = { setupVideoExport, validateSnapshot };
