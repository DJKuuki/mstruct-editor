import { makeError } from "./mstruct-diagnostics.js";

export const COMMENT_LANGUAGES = ["zh_cn", "en"];

function positiveCommentNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function normalizeComments(value = []) {
  const byNumber = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const number = positiveCommentNumber(item?.number ?? item?.id);
    if (!number) continue;
    const current = byNumber.get(number) ?? { number, texts: { zh_cn: "", en: "" } };
    for (const language of COMMENT_LANGUAGES) {
      if (item?.texts?.[language] !== undefined) {
        current.texts[language] = String(item.texts[language] ?? "").replace(/\r\n?/g, "\n");
      }
    }
    byNumber.set(number, current);
  }
  return [...byNumber.values()].sort((left, right) => left.number - right.number);
}

export function commentText(comments, number, locale = "zh") {
  const comment = normalizeComments(comments).find((item) => item.number === Number(number));
  if (!comment) return null;
  const preferred = locale === "en" ? "en" : "zh_cn";
  const fallback = preferred === "en" ? "zh_cn" : "en";
  const text = comment.texts[preferred] || comment.texts[fallback] || "";
  return { number: comment.number, language: comment.texts[preferred] ? preferred : fallback, text };
}

function documentError(line, code, details = {}) {
  return { line, code, details, message: code };
}

export function parseCommentBlock(block) {
  const lines = String(block ?? "").replace(/\r\n?/g, "\n").split("\n");
  const comments = new Map();
  const definitions = new Set();
  const errors = [];
  let active = null;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const opening = /^\[COMMENT:(\d+)<(zh_cn|en)>\]\s*$/.exec(line);
    const closing = /^\[\/COMMENT:(\d+)<(zh_cn|en)>\]\s*$/.exec(line);
    if (!active) {
      if (!line.trim()) continue;
      if (!opening) {
        errors.push(documentError(lineNumber, "comment-definition"));
        continue;
      }
      const number = positiveCommentNumber(opening[1]);
      if (!number) {
        errors.push(documentError(lineNumber, "comment-number"));
        continue;
      }
      active = { number, language: opening[2], line: lineNumber, body: [] };
      continue;
    }

    if (closing) {
      const number = positiveCommentNumber(closing[1]);
      const language = closing[2];
      if (number !== active.number || language !== active.language) {
        errors.push(documentError(lineNumber, "comment-definition-close", {
          number: active.number,
          language: active.language,
        }));
        continue;
      }
      const comment = comments.get(active.number) ?? { number: active.number, texts: { zh_cn: "", en: "" } };
      const definitionKey = `${active.number}:${active.language}`;
      if (definitions.has(definitionKey)) {
        errors.push(documentError(active.line, "comment-definition-duplicate", {
          number: active.number,
          language: active.language,
        }));
      } else {
        definitions.add(definitionKey);
        comment.texts[active.language] = active.body.join("\n").replace(/^\n+|\n+$/g, "");
        comments.set(active.number, comment);
      }
      active = null;
      continue;
    }
    if (/\[(?:\/)?COMMENT:/i.test(line)) {
      errors.push(documentError(lineNumber, "comment-body-syntax"));
      continue;
    }
    active.body.push(line);
  }

  if (active) {
    errors.push(documentError(active.line, "comment-definition-unclosed", {
      number: active.number,
      language: active.language,
    }));
  }
  return { comments: normalizeComments([...comments.values()]), errors };
}

export function serializeCommentBlock(value) {
  const lines = ["COMMENT:", ""];
  for (const comment of normalizeComments(value)) {
    const populatedLanguages = COMMENT_LANGUAGES.filter((language) => comment.texts[language]);
    const languages = populatedLanguages.length ? populatedLanguages : ["zh_cn"];
    for (const language of languages) {
      lines.push(`[COMMENT:${comment.number}<${language}>]`);
      if (comment.texts[language]) lines.push(comment.texts[language]);
      lines.push(`[/COMMENT:${comment.number}<${language}>]`, "");
    }
  }
  lines.push("END_COMMENT");
  return lines.join("\n");
}

export function createCommentState() {
  return { active: null, ranges: [], nextRangeId: 1 };
}

export function parseCommentToken(token, source, errors) {
  const content = token.content.trim();
  const opening = /^COMMENT:(\d+)$/.exec(content);
  const oneShot = /^\/COMMENT:(\d+)$/.exec(content);
  if (opening) return { kind: "start", number: Number(opening[1]), start: token.start, end: token.end };
  if (oneShot) return { kind: "oneshot", number: Number(oneShot[1]), start: token.start, end: token.end };
  if (content === "/COMMENT") return { kind: "end", number: null, start: token.start, end: token.end };
  if (/^\/?COMMENT/i.test(content)) {
    makeError(errors, source, "invalid-comment-event", token.start, token.end, { domain: "comment" });
    return { kind: "invalid", number: null, start: token.start, end: token.end };
  }
  return null;
}

function hasDefinition(definitions, number) {
  return definitions.some((comment) => comment.number === number);
}

export function applyCommentToken({ comment, definitions, commentState, slot, source, errors }) {
  if (comment.kind === "invalid") return;
  if (slot.closedByControl) makeError(errors, source, "control-marker-order", comment.start, comment.end);
  if (comment.kind === "end") {
    if (!commentState.active) {
      makeError(errors, source, "comment-close-without-open", comment.start, comment.end, { domain: "comment" });
      return;
    }
    const active = commentState.active;
    active.end = comment.end;
    slot.comments.push({ kind: "end", number: active.number, rangeId: active.id, start: comment.start, end: comment.end });
    slot.commentActive = true;
    commentState.active = null;
    return;
  }

  if (!positiveCommentNumber(comment.number)) {
    makeError(errors, source, "comment-number", comment.start, comment.end, { domain: "comment" });
    return;
  }
  if (!hasDefinition(definitions, comment.number)) {
    makeError(errors, source, "unknown-comment", comment.start, comment.end, {
      domain: "comment",
      details: { number: comment.number },
    });
    return;
  }
  if (commentState.active) {
    makeError(errors, source, "comment-overlap", comment.start, comment.end, { domain: "comment" });
    return;
  }
  if (slot.comments.some((item) => item.kind !== "end")) {
    makeError(errors, source, "duplicate-comment", comment.start, comment.end, { domain: "comment" });
    return;
  }
  slot.commentActive = true;
  if (comment.kind === "oneshot") {
    slot.comments.push({ ...comment });
    return;
  }
  const range = {
    id: commentState.nextRangeId,
    number: comment.number,
    start: comment.start,
    end: null,
  };
  commentState.nextRangeId += 1;
  commentState.ranges.push(range);
  commentState.active = range;
  slot.comments.push({ ...comment, rangeId: range.id });
}

export function finishCommentState(commentState, source, errors) {
  if (!commentState.active) return;
  makeError(errors, source, "comment-unfinished", commentState.active.start, commentState.active.start + 1, {
    domain: "comment",
    details: { number: commentState.active.number },
  });
}
