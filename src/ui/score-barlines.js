/** Keep both edges on device pixels so fractional layout does not vary the ink. */
export function snapScoreBarline(left, width, pixelRatio = 1) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return {
    left: Math.round(left * ratio) / ratio,
    width: Math.max(1, Math.round(width * ratio)) / ratio,
  };
}

/** Screen-only paint correction; measure tracks and vector export stay unchanged. */
export function alignScoreBarlines(chart) {
  const win = chart.ownerDocument.defaultView;
  const ratio = win.devicePixelRatio;
  for (const boundary of chart.querySelectorAll('.measure-barline, .control-boundary.is-double-bar')) {
    const rect = boundary.getBoundingClientRect();
    const style = win.getComputedStyle(boundary);
    const fontSize = parseFloat(style.fontSize) || 16;
    const double = boundary.classList.contains('is-double-bar');
    const width = rect.width || fontSize * .125;
    for (const [side, offset] of double ? [['before', -.22], ['after', .22]] : [['before', 0]]) {
      const snapped = snapScoreBarline(rect.left + offset * fontSize, width, ratio);
      boundary.style.setProperty(`--barline-${side}-left`, `${snapped.left - rect.left}px`);
      boundary.style.setProperty('--barline-pixel-width', `${snapped.width}px`);
    }
    boundary.classList.add('is-pixel-aligned');
  }
}
