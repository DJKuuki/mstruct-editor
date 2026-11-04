import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMstruct } from "../src/core/mstruct.js";
import { createVideoExportPlan, pianoExportEvents } from "../src/core/video-export.js";
import encoding from "../desktop/video-encoding.cjs";
import native from "../desktop/video-export.cjs";
import { EventEmitter } from "node:events";
import capture from "../desktop/raster-capture.cjs";

function markerImage(sequence) {
  const size = { width: 100, height: 20 }, bitmap = Buffer.alloc(size.width * size.height * 4, 255);
  const bits = `10100101${(sequence >>> 0).toString(2).padStart(32, '0')}`;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 80; x++) {
    const offset = (y * size.width + x) * 4;
    bitmap.fill(bits[Math.floor(x / 2)] === '1' ? 255 : 0, offset, offset + 3);
  }
  return { getSize: () => size, toBitmap: () => bitmap };
}

test("verified raster capture rejects stale paint tokens and owns the matched frame bytes", async () => {
  const contents = new EventEmitter(); let image, sequence;
  contents.isDestroyed = () => false;
  contents.executeJavaScript = async code => { sequence = JSON.parse(code.match(/const state = (.*);/)[1]).sequence; };
  contents.invalidate = () => {
    contents.emit('paint', {}, {}, markerImage(sequence - 1));
    image = markerImage(sequence); contents.emit('paint', {}, {}, image);
  };
  const result = await capture.capturePaintedTile(contents, { left: 1024, top: 0, width: 80, height: 16 });
  assert.equal(capture.paintMarkerMatches(result.bitmap, result.size, sequence), true);
  assert.equal(capture.paintMarkerMatches(result.bitmap, result.size, sequence - 1), false);
  image.toBitmap().fill(0);
  assert.equal(capture.paintMarkerMatches(result.bitmap, result.size, sequence), true);
  assert.equal(result.rowOffset, 4);
  assert.equal(contents.listenerCount('paint'), 0);
  assert.equal(contents.listenerCount('destroyed'), 0);
});

test("verified raster capture retries bounded timeouts and stops on a closed window", async () => {
  const contents = new EventEmitter(); let sequence, attempts = 0;
  contents.isDestroyed = () => false;
  contents.executeJavaScript = async code => { sequence = JSON.parse(code.match(/const state = (.*);/)[1]).sequence; };
  contents.invalidate = () => { if (++attempts === 2) contents.emit('paint', {}, {}, markerImage(sequence)); };
  await capture.capturePaintedTile(contents, { left: 0, top: 0, width: 80, height: 16 }, { timeoutMs: 5 });
  assert.equal(attempts, 2);
  contents.invalidate = () => contents.emit('destroyed');
  await assert.rejects(capture.capturePaintedTile(contents, { left: 0, top: 0, width: 80, height: 16 }), /closed/);
  contents.invalidate = () => { attempts++; }; attempts = 0;
  await assert.rejects(capture.capturePaintedTile(contents, { left: 0, top: 0, width: 80, height: 16 }, { timeoutMs: 5 }), /timed out/);
  assert.equal(attempts, 3); assert.equal(contents.listenerCount('paint'), 0);
});

test("video uses actual preview offsets, repeats and a fixed 1080p/30fps clock", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=120}{TC:C}{||:}C|I;G|V{:||};", { isStableTempo: true });
  const model = createVideoExportPlan(result, { isStableTempo: true, offset: "100" }, { userOffset: -30, temporaryOffset: 10 });
  assert.equal(model.plan.entries.length, 4);
  assert.equal(model.plan.entries[0].startMs, 80);
  assert.equal(model.durationMs, 2080);
  assert.deepEqual([model.width, model.height, model.fps, model.frameCount], [1920, 1080, 30, 63]);
});

test("timeline video ignores score OFFSET and retains audio tails", () => {
  const result = parseMstruct("{BN:1}{TS:3/4}{D:1/4}C|,D|,E|;");
  const timelineDocument = { metadata: { musicLength: "0:08" }, loop: "", main: "{BN:1}{TS:3/4}{D:1/4}[1000,1],[,1],[5000,1];" };
  const model = createVideoExportPlan(result, { isStableTempo: false, offset: "999" }, { timelineDocument, userOffset: -30, temporaryOffset: 55, bgmDurationMs: 10000 });
  assert.equal(model.plan.entries[0].startMs, 1025);
  assert.equal(model.plan.durationMs, 8000);
  assert.equal(model.frameCount, 300);
});

test("30 and 60 fps share the same musical duration and matching encoder timing", () => {
  const result = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{BPM:1/4=120}C|,G|;", { isStableTempo: true });
  for (const fps of [30, 60]) {
    const model = createVideoExportPlan(result, { isStableTempo: true }, {}, fps);
    assert.equal(model.durationMs, 1000);
    assert.equal(model.frameCount, fps);
    assert.equal(model.fps, fps);
    const args = encoding.videoEncodingArguments({ frameCount: model.frameCount, fps, pianoPath: "piano.f32", output: "one-second.mp4" });
    assert.equal(args[args.indexOf("-framerate") + 1], String(fps));
    assert.equal(args[args.indexOf("-t") + 1], "1");
    assert.equal(args[args.indexOf("-g") + 1], String(fps * 2));
    assert.match(args[args.indexOf("-filter_complex") + 1], /atrim=duration=1\[audio\]/);
    assert.doesNotThrow(() => native.validateSnapshot({ main: "", metadata: {}, profile: {}, playback: { bgmVolume: 100 }, fps }));
  }
  for (const fps of [0, 24, 120, "60", null, NaN]) {
    assert.throws(() => createVideoExportPlan(result, { isStableTempo: true }, {}, fps), /frame rate/);
    assert.throws(() => encoding.videoEncodingArguments({ frameCount: 60, fps }), /frame rate/);
    assert.throws(() => native.validateSnapshot({ main: "", metadata: {}, profile: {}, playback: { bgmVolume: 100 }, fps }), /frame rate/);
  }
});

test("piano export attacks once per sustained route group, including clipped preroll", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=120}C|;-;D|;", { isStableTempo: true });
  const { plan } = createVideoExportPlan(result, { isStableTempo: true }, { userOffset: -30 });
  const events = pianoExportEvents(plan);
  assert.equal(events.length, 2);
  assert.equal(events[0].startMs, 0);
  assert.equal(events[0].endMs, 970);
  assert.equal(events[1].startMs, 970);
});

test("unplayable input and unbounded durations cannot start video export", () => {
  assert.throws(() => createVideoExportPlan(parseMstruct(""), { isStableTempo: true }), /videoPlaybackUnavailable/);
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=120}C|;", { isStableTempo: true });
  assert.throws(() => createVideoExportPlan(result, { isStableTempo: true }, { bgmDurationMs: 7 * 3600000 }), /videoTooLong/);
  assert.throws(() => native.validateSnapshot({ main: "", metadata: {}, profile: {}, playback: { bgmVolume: NaN } }), /volume/);
  const snapshot = { main: "", metadata: {}, profile: {}, playback: { bgmVolume: 100, presentationMode: "video" }, bgm: { name: "clip.mp4", bytes: new ArrayBuffer(8) } };
  assert.doesNotThrow(() => native.validateSnapshot(snapshot));
  assert.throws(() => native.validateSnapshot({ ...snapshot, playback: { ...snapshot.playback, presentationMode: "invalid" } }), /presentation mode/);
});

test("video IPC rejects foreign senders before opening a native save dialog", async () => {
  const handlers = new Map(); let dialogs = 0;
  native.setupVideoExport({ ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    app: { on() {} }, dialog: { showSaveDialog() { dialogs++; } }, assertTrustedSender() { throw new Error("untrusted"); } });
  await assert.rejects(handlers.get("mstruct-video:start")({}, {}), /untrusted/);
  assert.equal(dialogs, 0);
});

test("native video encoding selects macOS VideoToolbox and preserves Windows Media Foundation options", () => {
  const options = { frameCount: 60, fps: 60, output: "test.mp4" };
  const windows = encoding.videoEncodingArguments({ ...options, platform: "win32" });
  const mac = encoding.videoEncodingArguments({ ...options, platform: "darwin" });
  assert.deepEqual(windows.slice(windows.indexOf("-c:v"), windows.indexOf("-pix_fmt")), ["-c:v", "h264_mf", "-hw_encoding", "0"]);
  assert.deepEqual(mac.slice(mac.indexOf("-c:v"), mac.indexOf("-pix_fmt")), ["-c:v", "h264_videotoolbox", "-allow_sw", "1"]);
  assert.deepEqual(windows.slice(windows.indexOf("-pix_fmt")), mac.slice(mac.indexOf("-pix_fmt")));
  assert.throws(() => encoding.videoEncodingArguments({ ...options, platform: "unsupported" }), /Unsupported/);
});

const ffmpeg = fileURLToPath(new URL(`../desktop/assets/video-encoder/bin/${process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"}`, import.meta.url));
test("encoded AAC remains below clipping with two overloaded correlated sources", { skip: !existsSync(ffmpeg) }, async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "mstruct-video-mix-"));
  const pcm = Buffer.alloc(48000 * 2 * 4);
  for (let sample = 0; sample < 48000; sample++) {
    const value = 1.6 * Math.sin(2 * Math.PI * 440 * sample / 48000);
    pcm.writeFloatLE(value, sample * 8); pcm.writeFloatLE(value, sample * 8 + 4);
  }
  const music = path.join(directory, "music.wav"), piano = path.join(directory, "piano.f32"), output = path.join(directory, "mixed.m4a"), decoded = path.join(directory, "decoded.f32");
  await writeFile(piano, pcm);
  const run = promisify(execFile);
  await run(ffmpeg, ["-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", piano, "-c:a", "pcm_f32le", music], { windowsHide: true });
  const args = encoding.videoEncodingArguments({ frameCount: 30, bgmPath: music, pianoPath: piano, output });
  const filter = args[args.indexOf("-filter_complex") + 1];
  await run(ffmpeg, ["-v", "error", "-y", "-i", music, "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", piano,
    "-filter_complex", filter.replaceAll("[1:a:0]", "[0:a:0]").replaceAll("[2:a:0]", "[1:a:0]"), "-map", "[audio]", "-c:a", "aac", "-b:a", "192k", output], { windowsHide: true });
  await run(ffmpeg, ["-v", "error", "-y", "-i", output, "-f", "f32le", decoded], { windowsHide: true });
  const bytes = await readFile(decoded); let peak = 0, energy = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) { const value = bytes.readFloatLE(offset); peak = Math.max(peak, Math.abs(value)); energy += value * value; }
  assert.ok(peak < 0.95 && peak > 0.7, `AAC peak ${peak}`);
  assert.ok(Math.sqrt(energy / (bytes.length / 4)) > 0.4, "Limiter must retain useful loudness.");
  context.diagnostic(`Decoded AAC peak: ${(20 * Math.log10(peak)).toFixed(2)} dBFS`);
});
