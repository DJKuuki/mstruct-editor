/** Center transport while it fits, then yield only enough space to avoid collisions. */
export function observeRendererNavHeight(nav) {
  const panel = nav.parentElement;
  const groups = [...nav.children].slice(0, 3);
  let frame = null;
  let previousHeight = 0;
  const visibleWidth = (group) => {
    if (getComputedStyle(group).display === "none") return 0;
    const items = [...group.children].filter((item) => {
      const style = getComputedStyle(item);
      return style.display !== "none" && style.position !== "absolute";
    });
    const gap = parseFloat(getComputedStyle(group).columnGap) || 0;
    return items.reduce((width, item) => width + item.getBoundingClientRect().width, 0)
      + gap * Math.max(0, items.length - 1);
  };
  const update = () => {
    frame = null;
    const style = getComputedStyle(nav);
    const available = nav.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const [left, transport, right] = groups.map(visibleWidth);
    const gap = parseFloat(style.columnGap) || 0;
    const next = left + transport + right + 2 * gap <= available + .5 ? "single"
      : left + right + gap <= available + .5 ? "wrapped" : "stacked";
    if (nav.dataset.rendererNavLayout !== next) nav.dataset.rendererNavLayout = next;
    const height = nav.getBoundingClientRect().height;
    // A hosted viewer hides this navigation until fullscreen takes it over.
    if (height > 0 && height !== previousHeight) {
      previousHeight = height;
      panel.style.setProperty("--renderer-nav-height", `${height}px`);
    }
  };
  const observer = new ResizeObserver(() => {
    if (frame === null) frame = requestAnimationFrame(update);
  });
  observer.observe(nav);
  groups.forEach((group) => observer.observe(group));
  update();
  return () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
