import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { ICON_SIZES } = createRequire(import.meta.url)("./generate-icon.cjs");

const soundfontUrl = new URL("./assets/soundfonts/acoustic_grand_piano-ogg.js", import.meta.url);
const licenseUrl = new URL("./assets/licenses/CC-BY-SA-3.0.txt", import.meta.url);
const noticesUrl = new URL("./assets/THIRD_PARTY_NOTICES.txt", import.meta.url);
const iconUrl = new URL("./generated/icon.ico", import.meta.url);

async function sha256(url) {
  return createHash("sha256").update(await readFile(url)).digest("hex");
}

const soundfont = await readFile(soundfontUrl, "utf8");
assert.ok(soundfont.includes("MIDI.Soundfont.acoustic_grand_piano"), "Unexpected Musyng Kite soundfont payload.");
assert.equal(await sha256(soundfontUrl), "54680c0289541f06932b77d1fbdd52e362c3518bbda8b1e2233e051d667d2767", "Musyng Kite soundfont checksum changed.");
assert.equal(await sha256(licenseUrl), "3f941b3b89cf7b8370ceb83cc76d2120d471b58735d8ca60238a751a48d7f72f", "CC BY-SA 3.0 license checksum changed.");
assert.match(await readFile(noticesUrl, "utf8"), /Musyng Kite[\s\S]*CC BY-SA 3\.0/);
const icon = await readFile(iconUrl);
assert.equal(icon.readUInt16LE(0), 0, "Unexpected ICO reserved field.");
assert.equal(icon.readUInt16LE(2), 1, "Generated desktop icon is not an ICO image.");
assert.equal(icon.readUInt16LE(4), ICON_SIZES.length, "Generated desktop icon must contain seven sizes.");
for (const [index, size] of ICON_SIZES.entries()) {
  const entry = 6 + index * 16, offset = icon.readUInt32LE(entry + 12), length = icon.readUInt32LE(entry + 8);
  assert.equal(icon[entry] || 256, size); assert.equal(icon[entry + 1] || 256, size);
  assert.ok(offset + length <= icon.length);
  assert.deepEqual([...icon.subarray(offset, offset + 8)], [137, 80, 78, 71, 13, 10, 26, 10], "ICO payload is not PNG-compressed.");
  assert.equal(icon.readUInt32BE(offset + 16), size); assert.equal(icon.readUInt32BE(offset + 20), size);
}
const videoEncoder = JSON.parse(await readFile(new URL("./video-encoder.json", import.meta.url), "utf8"));
for (const [name, expected] of Object.entries(videoEncoder.files)) {
  assert.equal(await sha256(new URL(`./assets/video-encoder/bin/${name}`, import.meta.url)), expected, `Video encoder checksum changed: ${name}`);
}
assert.match(await readFile(new URL("./assets/video-encoder/LICENSE-LGPLv3.txt", import.meta.url), "utf8"), /LESSER GENERAL PUBLIC LICENSE/);
assert.match(await readFile(new URL("./assets/video-encoder/LICENSE-GPLv3.txt", import.meta.url), "utf8"), /GNU GENERAL PUBLIC LICENSE/);
console.log("Desktop assets verified.");
