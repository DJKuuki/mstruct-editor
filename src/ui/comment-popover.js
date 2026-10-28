import { commentText } from "../core/mstruct-comments.js";

export function createCommentPopover({ dialog, closeButton, heading, languageLabel, body, getComments, getLocale, getHostedPopoverDocument, renderCommentText, tr }) {
  let current = null;

  function localTargetRect(target) {
    const rect = target.getBoundingClientRect();
    const frameRect = getHostedPopoverDocument() ? window.frameElement?.getBoundingClientRect() : null;
    return frameRect ? {
      left: frameRect.left + rect.left,
      right: frameRect.left + rect.right,
      top: frameRect.top + rect.top,
      bottom: frameRect.top + rect.bottom,
      width: rect.width,
      height: rect.height,
    } : rect;
  }

  function position() {
    if (!current?.target?.isConnected || !dialog.open) return;
    const targetRect = localTargetRect(current.target);
    const dialogRect = dialog.getBoundingClientRect();
    const viewport = getHostedPopoverDocument()?.defaultView ?? window;
    const edge = 12;
    const gap = 10;
    const left = Math.min(Math.max(edge, targetRect.left + targetRect.width / 2 - dialogRect.width / 2), Math.max(edge, viewport.innerWidth - dialogRect.width - edge));
    const above = targetRect.top - dialogRect.height - gap;
    const top = above >= edge ? above : Math.min(targetRect.bottom + gap, Math.max(edge, viewport.innerHeight - dialogRect.height - edge));
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  }

  function close() {
    current?.target?.setAttribute?.("aria-expanded", "false");
    current = null;
    if (dialog.open) dialog.close();
  }

  function open(number, target) {
    const resolved = commentText(getComments(), number, getLocale());
    if (!resolved) return;
    current?.target?.setAttribute?.("aria-expanded", "false");
    current = { number, target };
    target.setAttribute?.("aria-expanded", "true");
    heading.textContent = tr("commentNumber", { count: number });
    languageLabel.textContent = resolved.language === "en" ? "English" : "简体中文";
    renderCommentText(body, resolved.text);
    if (!dialog.open) dialog.show();
    window.requestAnimationFrame(position);
  }

  closeButton.addEventListener("click", close);
  return { openCommentPopover: open, closeCommentPopover: close, positionCommentPopover: position, getCurrentCommentPopover: () => current };
}
