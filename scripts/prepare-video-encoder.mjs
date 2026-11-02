import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, readdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "desktop/video-encoder.json"), "utf8"));
const target = path.join(root, "desktop/assets/video-encoder");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function verify() {
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (hash(await readFile(path.join(target, "bin", name))) !== expected) throw new Error(`Unexpected video encoder: ${name}`);
  }
  await readFile(path.join(target, "LICENSE-LGPLv3.txt"));
  await readFile(path.join(target, "LICENSE-GPLv3.txt"));
}
try { await verify(); console.log(`Video encoder verified: ${manifest.version}`); process.exit(0); } catch { /* Prepare missing or changed assets. */ }
const cache = path.join(root, ".backups/video-export-toolchain");
await mkdir(cache, { recursive: true });
const archive = path.join(cache, "ffmpeg.zip");
let bytes;
try { bytes = await readFile(archive); } catch { /* First build downloads a pinned archive. */ }
if (!bytes || !manifest.archiveHashes.includes(hash(bytes))) {
  const response = await fetch(manifest.url);
  if (!response.ok) throw new Error(`Video encoder download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== manifest.archiveHashes[0]) throw new Error("Video encoder archive checksum mismatch.");
  await writeFile(archive, bytes);
}
const extracted = await mkdtemp(path.join(cache, "extract-"));
await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:MSTRUCT_VIDEO_ARCHIVE, $env:MSTRUCT_VIDEO_EXTRACT)"], {
  windowsHide: true, env: { ...process.env, MSTRUCT_VIDEO_ARCHIVE: archive, MSTRUCT_VIDEO_EXTRACT: extracted },
});
const directory = (await readdir(extracted, { withFileTypes: true })).find(entry => entry.isDirectory() && entry.name.startsWith("ffmpeg-"));
if (!directory) throw new Error("Video encoder archive layout changed.");
await mkdir(path.join(target, "bin"), { recursive: true });
for (const [name, expected] of Object.entries(manifest.files)) {
  const input = path.join(extracted, directory.name, "bin", name);
  if (hash(await readFile(input)) !== expected) throw new Error(`Unexpected video encoder: ${name}`);
  await copyFile(input, path.join(target, "bin", name));
}
await copyFile(path.join(extracted, directory.name, "LICENSE.txt"), path.join(target, "LICENSE-LGPLv3.txt"));
const gpl = await fetch("https://raw.githubusercontent.com/FFmpeg/FFmpeg/ad3b795b72/COPYING.GPLv3");
if (!gpl.ok) throw new Error("Could not download FFmpeg's accompanying GPLv3 license.");
await writeFile(path.join(target, "LICENSE-GPLv3.txt"), await gpl.text());
await writeFile(path.join(target, "SOURCE.json"), JSON.stringify(manifest, null, 2) + "\n");
await verify();
console.log(`Video encoder prepared: ${manifest.version}`);
