import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, copyFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "desktop/assets/video-encoder");
// Same FFmpeg revision as the Windows bundle; no external codec libraries.
export const FFMPEG_COMMIT = "ad3b795b72388fbb2b216e1e6fd38fba994e1df0";
const flags = ["--disable-gpl", "--disable-nonfree", "--disable-autodetect", "--disable-x86asm",
  "--disable-doc", "--disable-ffplay", "--disable-ffprobe", "--disable-debug", "--enable-small",
  "--enable-static", "--disable-shared", "--enable-videotoolbox",
  "--extra-cflags=-mmacosx-version-min=13.0", "--extra-ldflags=-mmacosx-version-min=13.0"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const run = promisify(execFile);

export async function verifyMacVideoEncoder() {
  const source = JSON.parse(await readFile(path.join(target, "SOURCE.json"), "utf8"));
  assert.equal(source.commit, FFMPEG_COMMIT);
  assert.equal(source.platform, "darwin");
  assert.equal(source.arch, process.arch);
  assert.deepEqual(source.configure, flags);
  for (const [name, expected] of Object.entries(source.files)) {
    assert.ok(["bin/ffmpeg", "ffmpeg-source.tar.gz", "BUILD.txt", "LICENSE-LGPLv2.1.txt"].includes(name));
    assert.equal(hash(await readFile(path.join(target, name))), expected, `FFmpeg checksum: ${name}`);
  }
  assert.equal(Object.keys(source.files).length, 4);
  assert.match(await readFile(path.join(target, "LICENSE-LGPLv2.1.txt"), "utf8"), /GNU LESSER GENERAL PUBLIC LICENSE/);
}

export async function prepareMacVideoEncoder() {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) throw Error("Build the macOS encoder on a native arm64 or x64 Mac.");
  try { await verifyMacVideoEncoder(); console.log("macOS video encoder verified."); return; } catch { /* Build pinned source. */ }
  const cache = path.join(root, ".backups/video-export-toolchain");
  await mkdir(cache, { recursive: true });
  const source = await mkdtemp(path.join(cache, "ffmpeg-mac-"));
  const options = { cwd: source, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "13.0" } };
  await run("git", ["init", "--quiet"], options);
  await run("git", ["fetch", "--depth=1", "https://github.com/FFmpeg/FFmpeg.git", FFMPEG_COMMIT], options);
  await run("git", ["checkout", "--detach", "FETCH_HEAD"], options);
  assert.equal((await run("git", ["rev-parse", "HEAD"], options)).stdout.trim(), FFMPEG_COMMIT);
  await mkdir(path.join(target, "bin"), { recursive: true });
  // Ship the complete corresponding source and exact build instructions with the app.
  await run("git", ["archive", "--format=tar.gz", "--prefix=ffmpeg/", `--output=${path.join(target, "ffmpeg-source.tar.gz")}`, "HEAD"], options);
  console.log(`Building FFmpeg ${FFMPEG_COMMIT} for macOS ${process.arch}...`);
  await run("sh", ["configure", ...flags], options);
  await run("make", [`-j${Math.min(availableParallelism(), 4)}`, "ffmpeg"], options);
  const executable = path.join(target, "bin", "ffmpeg");
  await copyFile(path.join(source, "ffmpeg"), executable);
  await chmod(executable, 0o755);
  const version = (await run(executable, ["-version"], options)).stdout;
  assert.doesNotMatch(version, /--enable-(?:gpl|nonfree|libx264|libx265)/);
  const linked = (await run("otool", ["-L", executable], options)).stdout.split("\n").slice(1).filter(line => line.trim());
  assert.ok(linked.every(line => /^\s+\/(?:usr\/lib\/|System\/Library\/)/.test(line)), "FFmpeg must not depend on Homebrew or build-machine libraries.");
  await copyFile(path.join(source, "COPYING.LGPLv2.1"), path.join(target, "LICENSE-LGPLv2.1.txt"));
  const recipe = `FFmpeg ${FFMPEG_COMMIT}\nLGPL-2.1-or-later; Copyright the FFmpeg developers.\nSource: https://github.com/FFmpeg/FFmpeg/tree/${FFMPEG_COMMIT}\nUnmodified source: ffmpeg-source.tar.gz\nBuilt on macOS ${process.arch} using Apple clang and the macOS SDK.\nRebuild with Xcode Command Line Tools, git and make:\n  tar -xzf ffmpeg-source.tar.gz\n  cd ffmpeg\n  ./configure ${flags.join(" ")}\n  make -j4 ffmpeg\nThe replaceable executable is bin/ffmpeg. No external codec libraries are linked.\n\n${version}\n`;
  await writeFile(path.join(target, "BUILD.txt"), recipe);
  const files = {};
  for (const name of ["bin/ffmpeg", "ffmpeg-source.tar.gz", "BUILD.txt", "LICENSE-LGPLv2.1.txt"]) files[name] = hash(await readFile(path.join(target, name)));
  await writeFile(path.join(target, "SOURCE.json"), JSON.stringify({ platform: "darwin", arch: process.arch, commit: FFMPEG_COMMIT, license: "LGPL-2.1-or-later", configure: flags, files }, null, 2) + "\n");
  await verifyMacVideoEncoder();
}
