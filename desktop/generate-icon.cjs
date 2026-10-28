const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngIco(images) {
  if (images.length !== ICON_SIZES.length) throw new Error("Expected all seven icon sizes.");
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, index) => {
    const size = ICON_SIZES[index];
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE) || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Invalid ${size}px PNG source.`);
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images]);
}

async function main() {
  const source = path.join(__dirname, "icons");
  const destination = path.join(__dirname, "generated");
  const images = await Promise.all(ICON_SIZES.map(size => readFile(path.join(source, `app-${size}.png`))));
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(path.join(destination, "icon.ico"), pngIco(images)),
    writeFile(path.join(destination, "icon.png"), await readFile(path.join(source, "app-512.png"))),
  ]);
}

module.exports = { ICON_SIZES, pngIco };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
