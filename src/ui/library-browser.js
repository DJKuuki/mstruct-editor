import "./library-browser.css";
import { libraryCopy } from "./library-copy.js";
import { createLibraryDiff } from "./library-diff.js";

const node = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
export function createLibraryBrowser({ locale, actions }) {
  const shell = document.querySelector(".editor-app"), section = node("section", undefined, "library-browser");
  section.id = "libraryBrowser"; section.tabIndex = 0; section.hidden = true; shell.append(section);
  const button = node("button", undefined, "metadata-button"); button.id = "libraryButton";
  const switcher = document.querySelector("#editorToolSwitcher"), brand = node("div", undefined, "desktop-brand");
  switcher.before(brand); brand.append(switcher, button);
  const toolbar = node("div", undefined, "library-toolbar"), title = node("h2"), controls = {};
  toolbar.append(title);
  const c = (key, values) => libraryCopy(locale(), key, values);
  for (const key of ["choose", "import", "scan", "rebuild", "migrate", "folder", "analysis", "status"]) {
    const control = node("button"); control.type = "button"; controls[key] = control;
    control.addEventListener("click", () => actions[key]?.()); toolbar.append(control);
  }
  const root = node("p", undefined, "library-root"), snapshot = node("p", undefined, "library-snapshot"), progress = node("p", undefined, "library-progress"); progress.setAttribute("role", "status"); progress.setAttribute("aria-live", "polite");
  const form = node("form", undefined, "library-search"), inputs = {}, labels = {};
  for (const key of ["song", "technique"]) { const label = node("label"), span = node("span"), input = node("input"); input.id = `library-${key}`; input.type = "search"; label.append(span, input); form.append(label); inputs[key] = input; labels[key] = span; }
  const searchButton = node("button"); searchButton.type = "submit"; form.append(searchButton); form.addEventListener("submit", event => { event.preventDefault(); actions.search(); });
  const breadcrumb = node("div", undefined, "library-breadcrumb"), all = node("button"), back = node("button"), location = node("span");
  all.addEventListener("click", () => actions.navigate("")); back.addEventListener("click", () => actions.parent()); breadcrumb.append(all, back, location);
  const list = node("div", undefined, "library-list"); section.append(toolbar, root, snapshot, form, progress, breadcrumb, list);
  button.addEventListener("click", () => actions.home());
  let model = {}, busy = false, message = null;
  function refresh() {
    title.textContent = c("library"); button.textContent = c(section.hidden ? "returnLibrary" : "library");
    section.setAttribute("aria-label", c("library"));
    for (const [key, control] of Object.entries(controls)) { control.textContent = c(key); control.disabled = busy || (key !== "choose" && !model.root); }
    for (const key of Object.keys(labels)) labels[key].textContent = c(key);
    searchButton.textContent = c("search"); all.textContent = c("all"); back.textContent = c("back"); back.hidden = !model.folder;
    location.textContent = model.folder ?? ""; root.textContent = model.root ?? c("empty");
    const date = value => new Date(value).toLocaleString(locale() === "en" ? "en-US" : "zh-CN");
    snapshot.textContent = model.snapshot ? c("snapshot", { time: date(model.snapshot.generatedAt), checked: date(model.snapshot.checkedAt) }) : c("noSnapshot");
    if (message) progress.textContent = c(message.key, message.values);
    list.replaceChildren();
    for (const folder of model.folders ?? []) {
      const row = node("div", undefined, "library-row"), main = node("div", undefined, "library-row-main"), open = node("button", `▸ ${folder.split("/").at(-1)}`), tools = node("div", undefined, "library-row-actions");
      open.addEventListener("click", () => actions.navigate(folder)); main.append(open); row.append(main, tools);
      const openButton = node("button", c("open")); openButton.addEventListener("click", () => actions.navigate(folder)); tools.append(openButton);
      for (const key of ["rename", "trash"]) { const item = node("button", c(key)); item.addEventListener("click", () => actions[key](folder, true)); tools.append(item); }
      list.append(row);
    }
    for (const entry of model.entries ?? []) {
      const row = node("div", undefined, "library-row"), main = node("div", undefined, "library-row-main"), open = node("button", entry.metadata?.versionName || entry.path.split("/").at(-1)), tools = node("div", undefined, "library-row-actions");
      open.addEventListener("click", () => actions.open(entry)); main.append(open, node("small", entry.path));
      const sourceStatus = entry.origin?.status ?? "local", abnormal = !["local", "available"].includes(sourceStatus);
      if (abnormal) tools.append(node("span", c(sourceStatus), "library-source-status"));
      const openButton = node("button", c("open")); openButton.addEventListener("click", () => actions.open(entry)); tools.append(openButton);
      const metadata = entry.metadata;
      if (metadata) main.append(node("small", [metadata.songName, metadata.composers.map(item => item.name).filter(Boolean).join(", "), metadata.originalAnalyzer || metadata.creator].filter(Boolean).join(" · ")));
      if (!abnormal) main.append(node("span", c(sourceStatus), "library-badge"));
      if (entry.origin && entry.hash !== entry.origin.baseline) main.append(node("span", c("changed"), "library-badge"));
      if (entry.matches) main.append(node("span", String(entry.matches.length), "library-badge"));
      if (entry.status === "error") main.append(node("small", `${c(entry.error)}${entry.diagnostics?.[0] ? ` (${entry.diagnostics[0].code})` : ""}`, "library-warning"));
      if (entry.nameMismatch) { const fix = node("button", c("fixName")); fix.addEventListener("click", () => actions.fix(entry)); main.append(node("small", c("mismatch"), "library-warning"), fix); }
      for (const key of ["rename", "trash"]) { const item = node("button", c(key)); item.addEventListener("click", () => actions[key](entry.path, false)); tools.append(item); }
      row.append(main, tools); list.append(row);
    }
    if (!list.children.length) list.append(node("p", model.root ? c("noResults") : c("empty")));
  }
  function dialogBase(key) { const dialog = node("dialog", undefined, "library-dialog"); dialog.append(node("h2", c(key))); shell.append(dialog); return dialog; }
  function dialogResult(dialog, confirmKey = "confirm") {
    const footer = node("footer"), cancel = node("button", c("cancel")), confirm = node("button", c(confirmKey)); footer.append(cancel, confirm); dialog.append(footer);
    cancel.addEventListener("click", () => dialog.close("cancel"));
    return { confirm, result: new Promise(resolve => { dialog.addEventListener("close", () => { const accepted = dialog.returnValue === "confirm"; dialog.remove(); resolve(accepted); }, { once: true }); dialog.showModal(); }) };
  }
  return {
    query: () => ({ song: inputs.song.value, technique: inputs.technique.value }),
    show() { section.hidden = false; document.body.classList.add("library-open"); refresh(); },
    hide() { section.hidden = true; document.body.classList.remove("library-open"); refresh(); },
    get visible() { return !section.hidden; },
    update(next) { model = { ...model, ...next }; refresh(); },
    refreshLocale: refresh,
    busy(value) { busy = value; refresh(); },
    message(key, values, error = false) { message = { key, values }; progress.setAttribute("role", error ? "alert" : "status"); progress.textContent = c(key, values); },
    error(error) { const code = String(error.code ?? error.message).match(/(?:library|profile)-[a-z-]+/)?.[0]; this.message("error", { message: code ? c(code) : error.message }, true); },
    async name(key, value = "") {
      const dialog = dialogBase(key), input = node("input"); input.type = "text"; input.value = value; input.maxLength = 172; input.setAttribute("aria-label", c("name")); dialog.append(input);
      const { confirm, result } = dialogResult(dialog); confirm.addEventListener("click", () => { if (input.value.trim()) dialog.close("confirm"); });
      input.addEventListener("keydown", event => { if (event.key === "Enter") confirm.click(); }); input.focus(); input.select();
      return await result ? input.value.trim() : null;
    },
    async importPlan(plan) {
      const dialog = dialogBase("importPlan"), groups = new Map();
      for (const item of plan.records.filter(item => item.conflict)) { if (!groups.has(item.songId)) groups.set(item.songId, []); groups.get(item.songId).push(item); }
      dialog.append(node("p", c("importSummary", { writes: plan.records.filter(item => item.action === "write").length, conflicts: groups.size })), node("small", `${plan.generatedAt} · SHA-256 ${plan.sha256}`));
      const decisions = {};
      for (const [songId, records] of groups) {
        const fieldset = node("fieldset"), legend = node("legend", songId); fieldset.append(legend);
        for (const item of records) {
          const details = node("details"), summary = node("summary", item.localPath ?? item.remotePath);
          let rendered = false;
          const showDiff = () => {
            if (!details.open || rendered) return;
            rendered = true;
            details.append(createLibraryDiff({ local: item.localHash === null ? null : item.localText ?? "", remote: item.remoteText ?? "", copy: c }));
          };
          details.append(summary); details.addEventListener("toggle", showDiff); fieldset.append(details);
          details.open = true; showDiff();
        }
        for (const [value, key] of [["local", "useLocal"], ["remote", "useRemote"]]) { const label = node("label"), radio = node("input"); radio.type = "radio"; radio.name = songId; radio.value = value; radio.addEventListener("change", () => { decisions[songId] = value; }); label.append(radio, document.createTextNode(c(key))); fieldset.append(label); }
        dialog.append(fieldset);
      }
      const { confirm, result } = dialogResult(dialog, "importApply");
      confirm.addEventListener("click", () => { if ([...groups.keys()].every(key => decisions[key])) dialog.close("confirm"); else for (const input of dialog.querySelectorAll("input")) { if (!decisions[input.name]) { input.focus(); break; } } });
      return await result ? decisions : null;
    },
    async migrationTarget(profiles, preferred) {
      const dialog = dialogBase("migrate"), select = node("select"), hash = node("small");
      select.setAttribute("aria-label", c("migrationTarget"));
      for (const [index, profile] of profiles.entries()) {
        const option = node("option", `${profile.profileId} · ${profile.bundleHash.slice(7, 19)}`);
        option.value = String(index);
        option.selected = profile.profileId === preferred.profileId && profile.bundleHash === preferred.bundleHash;
        select.append(option);
      }
      const selected = () => profiles[Number(select.value)];
      const showHash = () => { hash.textContent = selected()?.bundleHash ?? ""; };
      select.addEventListener("change", showHash); showHash();
      dialog.append(node("p", c("migrationScope")), node("p", c("migrationTarget")), select, hash);
      const { confirm, result } = dialogResult(dialog, "migrationReview");
      confirm.disabled = !profiles.length;
      confirm.addEventListener("click", () => dialog.close("confirm"));
      return await result ? selected() : null;
    },
    async migrationPlan(plan, errorMessage) {
      const dialog = dialogBase("migrationReview");
      const count = status => plan.records.filter(record => record.status === status).length;
      dialog.append(node("p", `${plan.target.profileId}\n${plan.target.bundleHash}`),
        node("p", c("migrationSummary", { ready: count("ready"), current: count("current"), errors: count("error") })),
        node("p", c("migrationBackup")));
      const list = node("ul");
      for (const record of plan.records) {
        const item = node("li", `${record.path} — ${c("migrationStatus_" + record.status)}`);
        if (record.errors?.[0]) item.append(node("small", errorMessage(record.errors[0])));
        list.append(item);
      }
      dialog.append(list);
      const { confirm, result } = dialogResult(dialog, "migrationApply");
      confirm.disabled = count("ready") === 0;
      confirm.addEventListener("click", () => dialog.close("confirm"));
      return result;
    },
    async states(state) {
      const dialog = dialogBase("status");
      const entries = Object.entries(state.sources).filter(([key, source]) => key.startsWith("a:") && source.status !== "available");
      for (const [key, source] of entries) dialog.append(node("p", `${source.songId} · ${key} · ${c(source.status)} · ${source.localPath ?? ""}`));
      if (!entries.length) dialog.append(node("p", c("noChanges")));
      const close = node("button", c("confirm")); close.addEventListener("click", () => dialog.close()); dialog.append(close); dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.showModal();
    },
  };
}
