import { activeMstructSearchTags, MSTRUCT_SEARCH_INDEX_FORMAT_VERSION, projectMstructSearchEvents } from "./mstruct-search-events.js";
import { tonalReferenceModeKey } from "./tonal-reference.js";
import { sha256 } from "./profile.js";
import { parseMstructDocument } from "./mstruct-document.js";
import { readProfileIdentity } from "./profile-schema.js";
import { harmonySearchViews } from "./mstruct-search-roman.js";
const sha256Text = async (text) => (await sha256(text)).slice(7);
function profileIndexValues(source) {
    const document = parseMstructDocument(source);
    const identity = document.ok ? readProfileIdentity(document.metadata) : null;
    return { profileId: identity?.profileId ?? null, profileHash: identity?.bundleHash ?? null };
}
function tagBase(token) {
    const content = token.startsWith("<") && token.endsWith(">") ? token.slice(1, -1) : token;
    return content.split(":", 1)[0];
}
function addPosition(terms, term, position) {
    if (!term || term.endsWith(":"))
        return;
    const positions = terms.get(term) ?? new Set();
    positions.add(position);
    terms.set(term, positions);
}
function indexEventTerms(terms, event, position, globalTags) {
    for (const tag of activeMstructSearchTags(event, globalTags)) {
        addPosition(terms, `tag:${tag.token}`, position);
        addPosition(terms, `tag-base:${tagBase(tag.token)}`, position);
    }
    for (const tonalCenter of event.tonalCenters) {
        addPosition(terms, `tc:${tonalCenter}`, position);
        addPosition(terms, `tc-mode:${tonalReferenceModeKey(tonalCenter)}`, position);
    }
    if (event.tonalCenterNone)
        addPosition(terms, "tc:None", position);
    if (event.timeSignature) {
        addPosition(terms, `ts:${event.timeSignature}`, position);
        if (event.timeSignature !== "adlib") {
            const [numerator, denominator] = event.timeSignature.split("/");
            addPosition(terms, `ts-numerator:${numerator}`, position);
            addPosition(terms, `ts-denominator:${denominator}`, position);
        }
    }
    if (event.modulation) {
        addPosition(terms, `modulation:${event.modulation.type}`, position);
        if (event.modulation.target)
            addPosition(terms, `modulation-target:${event.modulation.target}`, position);
        if (event.modulation.relation)
            addPosition(terms, `modulation-relation:${event.modulation.relation}`, position);
    }
    for (const modulation of event.metricModulations ?? []) {
        addPosition(terms, "metric-modulation", position);
        addPosition(terms, `metric-modulation-from:${modulation.from}`, position);
        addPosition(terms, `metric-modulation-to:${modulation.to}`, position);
    }
    for (const bpm of event.bpms ?? []) {
        const [numerator, denominator] = bpm.beat.split("/");
        addPosition(terms, "bpm", position);
        addPosition(terms, `bpm-beat:${bpm.beat}`, position);
        addPosition(terms, `bpm-numerator:${numerator}`, position);
        addPosition(terms, `bpm-denominator:${denominator}`, position);
        addPosition(terms, `bpm-value:${bpm.tempo}`, position);
    }
    if (event.newRiemannian) {
        addPosition(terms, "nr", position);
        addPosition(terms, `nr-exact:${event.newRiemannian}`, position);
        addPosition(terms, `nr-length:${event.newRiemannian.length}`, position);
        addPosition(terms, `nr-first:${event.newRiemannian[0]}`, position);
        addPosition(terms, `nr-last:${event.newRiemannian.at(-1)}`, position);
    }
    for (const alternative of event.chord.alternatives) {
        addPosition(terms, `chord-source:${alternative.source}`, position);
        if (alternative.root)
            addPosition(terms, `chord-root:${alternative.root}`, position);
        if (alternative.rootPitchClass !== null)
            addPosition(terms, `chord-root-pc:${alternative.rootPitchClass}`, position);
        if (alternative.pitchSet) {
            addPosition(terms, `chord-structure-root:${alternative.pitchSet[0]}`, position);
            addPosition(terms, `chord-notes:${alternative.pitchSet[2]}`, position);
        }
        for (const atom of alternative.atoms)
            addPosition(terms, `chord-atom:${atom}`, position);
    }
    for (const alternative of event.roman.alternatives) {
        for (const view of harmonySearchViews(alternative)) {
            addPosition(terms, `roman-source:${view.source}`, position);
            for (const atom of view.atoms)
                addPosition(terms, `roman-atom:${atom}`, position);
            if (view.atoms[0])
                addPosition(terms, `roman-family:${view.atoms[0]}`, position);
        }
    }
    if (event.kind !== "harmony")
        addPosition(terms, `special-event:${event.kind}`, position);
    if (event.chord.type === "placeholder")
        addPosition(terms, "special-event:chord-placeholder", position);
    if (event.roman.type === "placeholder")
        addPosition(terms, "special-event:roman-placeholder", position);
}
/** @param {{ analysisId: number, songId: number, documentText: string, parsed: {ok: boolean}, globalTags: Array<{token: string}>, configHash: string, revisionToken?: string | null }} input */
export async function buildAnalysisSearchIndex({ analysisId, songId, documentText, parsed, globalTags, configHash, revisionToken = null, }) {
    const projection = projectMstructSearchEvents(parsed, { globalTags });
    const terms = new Map();
    projection.globalTags.forEach((tag) => {
        addPosition(terms, `global-tag:${tag.token}`, 0);
        addPosition(terms, `global-tag-base:${tagBase(tag.token)}`, 0);
    });
    projection.events.forEach((event, position) => indexEventTerms(terms, event, position, projection.globalTags));
    return {
        analysisId,
        songId,
        generation: crypto.randomUUID(),
        documentHash: await sha256Text(documentText),
        formatVersion: MSTRUCT_SEARCH_INDEX_FORMAT_VERSION,
        configHash,
        revisionToken,
        ...profileIndexValues(documentText),
        eventStreamJson: JSON.stringify(projection),
        terms: [...terms].map(([term, positions]) => ({ term, positionsJson: JSON.stringify([...positions]) })),
    };
}
