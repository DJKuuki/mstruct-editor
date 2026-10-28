const POPOVER_STYLES = [
  ["text-accidentals.css", "mstructTextAccidentalStyles"],
  ["chord-popover.css", "mstructChordPopoverStyles"],
  ["roman-popover.css", "mstructRomanPopoverStyles"],
  ["comment-popover.css", "mstructCommentPopoverStyles"],
  ["inline-music.css", "mstructInlineMusicStyles"],
];

function installStyles(parentDocument) {
  for (const [fileName, dataName] of POPOVER_STYLES) {
    if (parentDocument.querySelector(`link[href$="/mstruct-editor/${fileName}"], link[data-${dataName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`)) continue;
    const stylesheet = parentDocument.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL(`./${fileName}`, window.location.href).href;
    stylesheet.dataset[dataName] = "true";
    parentDocument.head.append(stylesheet);
  }
}

function isolateIds(popover, suffix) {
  for (const element of popover.querySelectorAll("[id]")) element.id = `${element.id}-${suffix}`;
  popover.id = `${popover.id}-${suffix}`;
  popover.setAttribute("aria-labelledby", popover.querySelector("h2").id);
}

export function mountHostedPopovers({ enabled, hostToken, chordPopover, romanPopover, commentPopover }) {
  if (!enabled || window.parent === window) return null;
  try {
    const parentDocument = window.parent.document;
    installStyles(parentDocument);
    const suffix = hostToken.replace(/[^A-Za-z0-9_-]/g, "-") || "hosted";
    for (const popover of [chordPopover, romanPopover, commentPopover]) {
      isolateIds(popover, suffix);
      parentDocument.body.append(popover);
    }
    return { parentDocument, chordPopover, romanPopover, commentPopover };
  } catch {
    return null;
  }
}

export function bindHostedPopoverLifecycle({ mount, closeChord, closeRoman, closeComment, positionChord, positionRoman, positionComment }) {
  if (!mount) return () => {};
  const { parentDocument, chordPopover, romanPopover, commentPopover } = mount;
  const hostWindow = parentDocument.defaultView;

  function handlePointerDown(event) {
    if (chordPopover.open && !chordPopover.contains(event.target)) closeChord();
    if (romanPopover.open && !romanPopover.contains(event.target)) closeRoman();
    if (commentPopover.open && !commentPopover.contains(event.target)) closeComment();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && chordPopover.open) closeChord();
    if (event.key === "Escape" && romanPopover.open) closeRoman();
    if (event.key === "Escape" && commentPopover.open) closeComment();
  }

  parentDocument.addEventListener("pointerdown", handlePointerDown);
  parentDocument.addEventListener("keydown", handleKeyDown);
  hostWindow?.addEventListener("scroll", closeChord, { passive: true });
  hostWindow?.addEventListener("resize", positionChord, { passive: true });
  hostWindow?.addEventListener("scroll", closeRoman, { passive: true });
  hostWindow?.addEventListener("resize", positionRoman, { passive: true });
  hostWindow?.addEventListener("scroll", closeComment, { passive: true });
  hostWindow?.addEventListener("resize", positionComment, { passive: true });

  return () => {
    parentDocument.removeEventListener("pointerdown", handlePointerDown);
    parentDocument.removeEventListener("keydown", handleKeyDown);
    hostWindow?.removeEventListener("scroll", closeChord);
    hostWindow?.removeEventListener("resize", positionChord);
    hostWindow?.removeEventListener("scroll", closeRoman);
    hostWindow?.removeEventListener("resize", positionRoman);
    hostWindow?.removeEventListener("scroll", closeComment);
    hostWindow?.removeEventListener("resize", positionComment);
    closeChord();
    closeRoman();
    closeComment();
    chordPopover.remove();
    romanPopover.remove();
    commentPopover.remove();
  };
}
