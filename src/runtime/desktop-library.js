import { createLibraryBrowser } from "../ui/library-browser.js";
import { buildLibraryIndex, searchLibrary, renameLibraryAnalysis, validateLibraryName, validateLibraryPackage } from "../core/library-index.js";
import { createEmptyMetadata, serializeMstructDocument } from "../core/mstruct-document.js";
import { serializeSearchVocabulary, deserializeSearchVocabulary } from "../core/profile-search.js";
import { AUTHORING_APP_VERSION } from "./authoring-version.js";

export function setupDesktopLibrary({ api, profiles, locale, session, onLeave, onOpen, stopPlayback, search, errorMessage }) {
  if (!api?.libraryScan) return null;
  let snapshot = null, index = { entries: [], families: [] }, folder = "", busy = false;
  const home = () => run(async () => {
    if ((await api.libraryLeave()).cancelled) return;
    onLeave(); stopPlayback(); ui.show();
    if (!await api.libraryState()) { ui.update({ root: null }); return; }
    await rescan();
  });
  const ui = createLibraryBrowser({ locale, actions: {
    home,
    choose: () => run(async () => { const result = await api.libraryChoose(); if (result.cancelled) return; folder = ""; onLeave(); stopPlayback(); ui.show(); await rescan(); }),
    scan: () => run(() => rescan()), rebuild: () => run(() => rescan(true)),
    search: () => render(), navigate: path => { folder = path; render(); }, parent: () => { folder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : ""; render(); },
    open: entry => run(async () => {
      ui.hide();
      if (await session().openLibrary(entry.path)) { onOpen(); if (ui.query().technique.trim()) search(ui.query().technique); }
      else ui.show();
    }),
    folder: () => run(async () => { const name = await ui.name("folder"); if (name === null) return; validateLibraryName(name); await api.libraryFolder({ parent: folder, name }); await rescan(); }),
    analysis: () => run(async () => {
      if (!folder) { ui.message("selectFolder"); return; }
      const name = await ui.name("analysis"); if (name === null) return; validateLibraryName(name);
      const profile = await profiles.recommended();
      const text = serializeMstructDocument({ main: "", comments: [], metadata: { ...createEmptyMetadata(), versionName: name,
        mstructFormatVersion: "1", mstructProfileId: profile.manifest.profileId, mstructProfileHash: profile.manifest.bundleHash, authoringAppVersion: AUTHORING_APP_VERSION } });
      const result = await api.libraryCreate({ folder, name, text });
      if (result.cancelled) return;
      await rescan(); ui.hide();
      if (await session().openLibrary(result.path)) onOpen(); else ui.show();
    }),
    rename: (path, isFolder) => rename(path, isFolder),
    fix: entry => rename(entry.path, false, entry.metadata.versionName),
    trash: path => run(async () => { const result = await api.libraryTrash(path); if (!result.cancelled) await rescan(); }),
    import: () => run(async () => {
      ui.message("validating"); const bundle = await api.libraryPrepare(); if (bundle.cancelled) return;
      try {
        await validateLibraryPackage(bundle.texts, bundle.catalog);
        const plan = await api.libraryPlan(bundle.token), decisions = await ui.importPlan(plan);
        if (decisions === null) return;
        const result = await api.libraryApply({ token: bundle.token, decisions }); if (result.cancelled) return;
        onLeave(); await rescan(); ui.message("importDone", { count: result.written });
      } finally { await api.libraryCancel(); }
    }),
    status: () => snapshot && ui.states(snapshot.state),
  } });
  api.onCommand?.(command => { if (command === "return-library" && !ui.visible) void home(); });
  async function run(operation) {
    if (busy) return;
    busy = true; ui.busy(true);
    try { return await operation(); } catch (error) { ui.error(error); } finally { busy = false; ui.busy(false); }
  }
  async function rescan(rebuild = false) {
    snapshot = await api.libraryScan();
    if (!snapshot.state.snapshot && api.libraryExtracted) {
      const extracted = await api.libraryExtracted();
      if (extracted) {
        await validateLibraryPackage(extracted.texts, extracted.catalog, { modified: extracted.modified });
        await api.libraryAdopt(extracted.token);
        snapshot = await api.libraryScan();
      }
    }
    for (const bundle of await api.libraryRules()) await profiles.install(bundle);
    const resolutions = new Map();
    index = await buildLibraryIndex({ files: snapshot.files, sources: snapshot.state.sources, cached: rebuild ? null : deserializeSearchVocabulary(snapshot.cache),
      resolveProfile: identity => { const key = JSON.stringify(identity); if (!resolutions.has(key)) resolutions.set(key, profiles.resolveForIndex(identity)); return resolutions.get(key); },
      onProgress: (done, total) => ui.message("indexing", { done, total }) });
    await api.libraryCache(serializeSearchVocabulary(index));
    if (folder && !snapshot.folders.includes(folder)) folder = "";
    render();
  }
  function render() {
    const result = searchLibrary(index, ui.query());
    if (!result.ok) { ui.message("error", { message: errorMessage(result.errors[0]) }, true); return; }
    const searching = Boolean(ui.query().song.trim() || ui.query().technique.trim());
    const descendants = snapshot?.folders.filter(path => path.startsWith(folder ? `${folder}/` : "") && !path.slice(folder ? folder.length + 1 : 0).includes("/")) ?? [];
    const entries = result.entries.filter(entry => searching || (entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "") === folder);
    ui.update({ root: snapshot?.root, snapshot: snapshot?.state.snapshot, folder, folders: searching ? [] : descendants, entries });
    const errors = index.entries.filter(entry => entry.status !== "ready").length;
    ui.message(errors ? "ready" : "readyAll", { total: index.entries.length, errors, ready: index.entries.length - errors });
  }
  async function rename(path, isFolder, fixedName) {
    return run(async () => {
      const file = snapshot.files.find(file => file.path === path);
      const initial = isFolder ? path.split("/").at(-1) : index.entries.find(entry => entry.path === path)?.metadata?.versionName ?? "";
      const name = fixedName ?? await ui.name("rename", initial); if (name === null) return; validateLibraryName(name);
      const result = await api.libraryRename({ path, folder: isFolder, name, text: isFolder ? undefined : renameLibraryAnalysis(file.text, name) });
      if (result.cancelled) return;
      if (isFolder && folder === path) folder = result.path;
      await rescan();
    });
  }
  return {
    get visible() { return ui.visible; },
    async start() { ui.show(); await run(async () => { if (await api.libraryState()) await rescan(); else ui.update({ root: null }); }); },
    refreshLocale() { ui.refreshLocale(); },
    opened() { ui.hide(); onOpen(); },
    async saved() { if (await api.libraryState()) await run(() => rescan()); },
  };
}
