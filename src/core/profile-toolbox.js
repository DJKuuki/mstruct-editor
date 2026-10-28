import { parseMstruct } from "./mstruct.js";
import { parseRomanBasicReference } from "./roman-symbol.js";
import { parseTonalReference } from "./tonal-reference.js";
import { MstructProfileError } from "./profile-schema.js";

const PREFIX = "{BN:1}{TS:adlib}{D:1}{TC:C}{BPM:1/4=60}";
const CHORD = "[C:C]";

function modulationExample(config) {
  const entries = [...config.romanConfig.basics.values()];
  const preferred = [...entries].sort((a, b) => Number(b.roman === "V") - Number(a.roman === "V"));
  for (const relation of preferred) {
    const originMode = relation.tonalMode || "M";
    const reference = parseRomanBasicReference(relation.roman, { config: config.romanConfig, tonalMode: originMode });
    const targetMode = /[iv]/.test(relation.roman) ? "m" : "M";
    const pivot = entries.find((entry) => entry.roman === (targetMode === "m" ? "i" : "I") && (!entry.tonalMode || entry.tonalMode === targetMode))
      ?? entries.find((entry) => !entry.tonalMode || entry.tonalMode === targetMode);
    if (!pivot) continue;
    const [, accidental, degree] = /^(bb|b|#|x|n)?([1-7])$/.exec(reference.degree);
    const note = "CDEFGAB"[Number(degree) - 1] + (accidental === "n" ? "" : accidental ?? "");
    const target = targetMode === "m" ? note.toLowerCase() : note;
    if (!parseTonalReference(target)) continue;
    return { origin: originMode === "m" ? "c" : "C", target,
      relation: relation.roman, pivot: pivot.roman };
  }
  throw new MstructProfileError("profile-toolbox-invalid", { row: 0, insertion: "{M:}", errors: [] });
}

/**
 * Toolbox entries are insertion templates, not standalone scores. Supply
 * values only for known empty input slots and give controls a valid context;
 * every resulting witness is checked by the real format-1 compiler. Unknown
 * syntax and tokens are never excused as placeholders.
 */
export function toolboxTemplateWitness(insertion, config) {
  const modulation = insertion.includes("{M:") || insertion.includes("{MH:") ? modulationExample(config) : null;
  const relation = modulation ? `${modulation.target}|${modulation.relation}` : "";
  const values = { BN: "1", TS: "adlib", D: "1", TC: "C", TEMPO: "Allegro",
    BPM: "1/4=60", BPMhidden: "1/4=60", MM: "1/4=1/4", MH: relation };
  let text = insertion.replace(/\{(BN|TS|D|TC|TEMPO|BPM|BPMhidden|MM|MH):\}/g, (_, key) => `{${key}:${values[key]}}`)
    .replaceAll("</FORM_END:>", `</FORM_END:${config.formTagConfig?.tags[0]?.token.slice(1, -1) ?? ""}>`)
    .replaceAll("<DTC:,>", "<DTC:a,C>")
    .replaceAll("<DTC:>", "<DTC:a,C>")
    .replaceAll('{TC:""}', '{TC:"C"}').replaceAll("{T=}", "{T=0:00}")
    .replaceAll('[C:|R:]', '[C:C]').replaceAll("[NR:]", "[NR:P]")
    .replaceAll("[F:||]", "[F:A||]").replaceAll("[COMMENT:]", "[COMMENT:1]")
    .replaceAll("{M:}", `{M:${relation}}`).replaceAll('{M:""|}', `{M:"${modulation?.target}"|${modulation?.relation}}`)
    .replaceAll('{MH:""|}', `{MH:"${modulation?.target}"|${modulation?.relation}}`);
  text = text.replace(/<(\/?)([^<>]+):(""|)>/g, (whole, closing, token, quoted) => {
    let parameter;
    if (token === "Centricity" || token.startsWith("Mode_") || token.startsWith("Scale_")) parameter = quoted ? '"C"' : "C";
    else if (token === "pedal") parameter = [...config.romanConfig.basics.keys()][0];
    else if (token === "Seq" || token === "SeqInv") parameter = config.semanticTagConfig.sequences.entries[0]?.sequenceType;
    else parameter = config.semanticTagConfig.cadences.parameterized.find((entry) => entry.prefix === token)?.allowedRomans[0];
    return parameter ? `<${closing}${token}:${parameter}>` : whole;
  });
  // Paired range templates leave the cursor between start and end; put music
  // there, so a duration_mode=2/3 tag and a modulation have an actual span.
  text = text.replace(/(\{M:[^}]+\})(\{\/M\})/g, `$1[C:C|R:${modulation?.relation}&${modulation?.pivot}]$2`)
    .replace(/(\[COMMENT:1\])(\[\/COMMENT\])/g, `$1${CHORD}$2`)
    .replace(/(<[^/][^>]*>)(<\/[^>]*>)/g, `$1${CHORD},$2${CHORD}`);
  if (insertion === "{ENDING:}{/ENDING}") {
    return `${PREFIX}{ENDING:1}${CHORD}{/ENDING:1}{:||};{ENDING:2}${CHORD}{/ENDING};`;
  }
  if (insertion === "{||:}") return `${PREFIX}${text}${CHORD}{:||};`;
  if (insertion === "{:||}" || insertion === "{||}") return `${PREFIX}${CHORD}${text};`;
  if (insertion === "..." || insertion === "{LB}") return `${PREFIX}${CHORD};${text}`;
  if (insertion === "{BN:}") return `${PREFIX}${CHORD};{BN:2}${CHORD};`;
  if (["X", "0", "-", "N.C.", "Clus", "ClusWK", "ClusBK"].includes(insertion)) {
    return `${PREFIX}${CHORD},${text};`;
  }
  const prefix = modulation ? PREFIX.replace("{TC:C}", `{TC:${modulation.origin}}`) : PREFIX;
  if (parseMstruct(`${prefix}${text};`, { ...config, comments: [{ number: 1, texts: {} }] }).ok) return `${prefix}${text};`;
  const context = text.includes("[NR:") ? `${prefix}${CHORD},` : prefix;
  const forcedTarget = /\{MH:([^|}]+)/.exec(text)?.[1];
  const target = forcedTarget ? parseTonalReference(forcedTarget) : null;
  const pivot = target ? [...config.romanConfig.basics.values()].find((entry) => !entry.tonalMode || entry.tonalMode === target.mode)?.roman : null;
  const following = target && pivot ? `[C:C|R:${pivot}]` : CHORD;
  return `${context}${text}${text.includes("[C:") ? "" : following};`;
}

export function validateProfileToolbox(config) {
  const comments = [{ number: 1, texts: { zh_cn: "", en: "" } }];
  for (const [index, event] of config.toolboxConfig.events.entries()) {
    const witness = toolboxTemplateWitness(event.insertion, config);
    const result = parseMstruct(witness, { ...config, comments });
    if (!result.ok) {
      throw new MstructProfileError("profile-toolbox-invalid", {
        row: index + 2, insertion: event.insertion,
        errors: result.errors.map(({ code, details, start, end }) => ({ code, details, start, end })),
      });
    }
  }
}
