import { getRendererScaleSnapshot, normalizeRendererScale, RENDERER_SCALE_STEP, writeRendererScale } from "../core/renderer-scale.js";

/** Desktop shortcut for the existing score scale; the host chooses the surface. */
export function setupDesktopScoreScale({ target, getScale = getRendererScaleSnapshot, updateScale = writeRendererScale }) {
  function onWheel(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    const next = normalizeRendererScale(getScale() - Math.sign(event.deltaY) * RENDERER_SCALE_STEP);
    if (next !== getScale()) updateScale(next);
  }
  target.addEventListener("wheel", onWheel, { passive: false });
  return () => target.removeEventListener("wheel", onWheel);
}
