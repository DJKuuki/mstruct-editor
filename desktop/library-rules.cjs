const { isDeepStrictEqual } = require("node:util");
const { digest } = require("./library-paths.cjs");

function assertMatchingRuleFile(relative, existing, incoming) {
  if (!existing || digest(existing) === digest(incoming)) return;
  // Validated packages may serialize the same manifest with different whitespace/key order.
  // Retain the existing bytes; CSV content and actual manifest values remain immutable.
  if (relative.split("/").at(-1) === "manifest.json") {
    try {
      if (isDeepStrictEqual(JSON.parse(existing), JSON.parse(incoming))) return;
    } catch { /* Malformed stored data is a conflict, never an implicit repair. */ }
  }
  throw Error("library-rules-immutable");
}

module.exports = { assertMatchingRuleFile };
