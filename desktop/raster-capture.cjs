const TILE_WIDTH = 1024, TILE_HEIGHT = 768;
const MARKER_HEIGHT = 4, MARKER_WIDTH = 80;
let captureSequence = 0;

function markerBits(sequence) {
  return `10100101${(sequence >>> 0).toString(2).padStart(32, '0')}`;
}

/** A binary marker rejects stale surfaces even when adjacent sequence numbers differ by one. */
function paintMarkerMatches(bitmap, size, sequence) {
  if (size.width < MARKER_WIDTH || size.height < MARKER_HEIGHT || bitmap.length !== size.width * size.height * 4) return false;
  const bits = markerBits(sequence);
  for (let index = 0; index < bits.length; index++) {
    const offset = (2 * size.width + index * 2 + 1) * 4;
    const expected = bits[index] === '1' ? 255 : 0;
    if (bitmap[offset + 3] !== 255) return false;
    for (let channel = 0; channel < 3; channel++) if (Math.abs(bitmap[offset + channel] - expected) > 16) return false;
  }
  return true;
}

function paintedTile(webContents, position, sequence, timeoutMs) {
  const gradient = [...markerBits(sequence)].map((bit, index) => `${bit === '1' ? '#fff' : '#000'} ${index * 2}px ${(index + 1) * 2}px`).join(',');
  const state = { left: -position.left, top: MARKER_HEIGHT - position.top, sequence, background: `linear-gradient(90deg,${gradient})` };
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); webContents.removeListener('paint', onPaint); webContents.removeListener('destroyed', destroyed); };
    const failed = error => { cleanup(); reject(error); };
    const destroyed = () => failed(new Error('Raster capture window closed.'));
    const onPaint = (_event, _dirty, image) => {
      try {
        const size = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 });
        if (!paintMarkerMatches(bitmap, size, sequence)) return;
        if (size.width < position.width || size.height < position.height + MARKER_HEIGHT) return;
        cleanup();
        // Keep an owned copy before Chromium can reuse the next paint surface.
        resolve({ bitmap: Buffer.from(bitmap), size, rowOffset: MARKER_HEIGHT });
      } catch (error) { failed(error); }
    };
    const timer = setTimeout(() => failed(Object.assign(new Error('Raster paint confirmation timed out.'), { code: 'PAINT_TIMEOUT' })), timeoutMs);
    webContents.on('paint', onPaint);
    webContents.once('destroyed', destroyed);
    void webContents.executeJavaScript(`(() => {
      const state = ${JSON.stringify(state)};
      const stage = document.querySelector('#scoreExportRasterStage');
      if (!stage) throw new Error('Missing capture stage.');
      let marker = document.querySelector('#mstructCaptureMarker');
      if (!marker) {
        marker = document.createElement('div'); marker.id = 'mstructCaptureMarker';
        marker.style.cssText = 'position:fixed;left:0;top:0;width:${MARKER_WIDTH}px;height:${MARKER_HEIGHT}px;z-index:2147483647;pointer-events:none;contain:strict';
        document.body.append(marker);
      }
      stage.style.transform = 'translate(' + state.left + 'px,' + state.top + 'px)';
      marker.style.background = state.background;
      marker.dataset.sequence = String(state.sequence);
    })()`, true).then(() => { if (!webContents.isDestroyed()) webContents.invalidate(); }, failed);
  });
}

async function capturePaintedTile(webContents, position, { timeoutMs = 1500 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    captureSequence = (captureSequence + 1) >>> 0;
    try { return await paintedTile(webContents, position, captureSequence, timeoutMs); }
    catch (error) { if (error.code !== 'PAINT_TIMEOUT' || attempt === 2) throw error; }
  }
}

/** Static exports retain their screenshot path. Video uses verified offscreen paint frames. */
async function captureRasterTiles(webContents, size, viewport, transparentBackground, { verifyPaint = false } = {}) {
  const gutter = verifyPaint ? MARKER_HEIGHT : 0;
  if (verifyPaint && (viewport.width < MARKER_WIDTH || viewport.height <= gutter)) throw new Error('Invalid video capture viewport.');
  const tileStepWidth = Math.max(1, Math.min(TILE_WIDTH, Math.floor(viewport.width)));
  const tileStepHeight = Math.max(1, Math.min(TILE_HEIGHT, Math.floor(viewport.height) - gutter));
  const bitmap = Buffer.alloc(size.width * size.height * 4, transparentBackground ? 0x00 : 0xff);
  for (let top = 0; top < size.height; top += tileStepHeight) {
    const tileHeight = Math.min(tileStepHeight, size.height - top);
    for (let left = 0; left < size.width; left += tileStepWidth) {
      const tileWidth = Math.min(tileStepWidth, size.width - left);
      let captured;
      if (verifyPaint) captured = await capturePaintedTile(webContents, { left, top, width: tileWidth, height: tileHeight });
      else {
        await webContents.executeJavaScript(`new Promise((resolve) => {
          document.querySelector("#scoreExportRasterStage").style.transform = "translate(${-left}px, ${-top}px)";
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })`, true);
        const tile = await webContents.capturePage({ x: 0, y: 0, width: tileWidth, height: tileHeight }, { stayHidden: true, stayAwake: true });
        if (tile.isEmpty()) throw new Error('Electron could not capture an exported page tile.');
        const tileSize = tile.getSize(1);
        if (tileSize.width !== tileWidth || tileSize.height !== tileHeight) throw new Error('Electron captured an exported page tile at an unexpected size.');
        captured = { bitmap: tile.toBitmap({ scaleFactor: 1 }), size: tileSize, rowOffset: 0 };
      }
      if (captured.bitmap.length !== captured.size.width * captured.size.height * 4) throw new Error('Electron returned an invalid exported page tile.');
      for (let row = 0; row < tileHeight; row++) {
        const sourceStart = ((row + captured.rowOffset) * captured.size.width) * 4;
        const targetStart = ((top + row) * size.width + left) * 4;
        captured.bitmap.copy(bitmap, targetStart, sourceStart, sourceStart + tileWidth * 4);
      }
    }
  }
  const { nativeImage } = require('electron');
  const image = nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height, scaleFactor: 1 });
  if (image.isEmpty()) throw new Error('Electron could not assemble the exported page tiles.');
  return image;
}

module.exports = { TILE_WIDTH, TILE_HEIGHT, paintMarkerMatches, capturePaintedTile, captureRasterTiles };
