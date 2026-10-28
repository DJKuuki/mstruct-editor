import { APPLICATION_COLOR_SCHEMES } from "../core/application-theme.js";

/** Shell settings receive storage/theme capabilities; renderer settings stay independent. */
export function createApplicationSettings({ button, tr, getColorScheme, setColorScheme, rules, openRules, errorMessage, getPlaybackOffset, setPlaybackOffset, userData }) {
  const dialog = document.createElement("dialog");
  dialog.className = "application-settings-dialog";
  dialog.setAttribute("aria-labelledby", "application-settings-title");
  dialog.innerHTML = `<header><h2 id="application-settings-title"></h2><button type="button" class="application-settings-close">×</button></header><div class="application-settings-content"><label for="application-color-scheme"></label><select id="application-color-scheme"></select><label class="application-rules-label" for="application-rules-url"></label><input id="application-rules-url" type="url" placeholder="https://…/api/mstruct-profiles"><p class="application-rules-help"></p><div class="application-rules-actions"><button type="button" class="application-rules-save"></button><button type="button" class="application-rules-manage"></button></div><p class="application-settings-storage"></p><p class="application-settings-status" role="status" hidden></p></div>`;
  document.body.append(dialog);
  const title = dialog.querySelector("h2"), close = dialog.querySelector("button"), label = dialog.querySelector("label"), select = dialog.querySelector("select"), storage = dialog.querySelector(".application-settings-storage"), status = dialog.querySelector(".application-settings-status");
  const url = dialog.querySelector("#application-rules-url"), save = dialog.querySelector(".application-rules-save"), manage = dialog.querySelector(".application-rules-manage");
  const userSettings = document.createElement("h3"), offsetLabel = document.createElement("label"), offset = document.createElement("input"), offsetHelp = document.createElement("p");
  const advanced = document.createElement("details"), advancedTitle = document.createElement("summary"); advanced.className = "application-advanced"; advanced.append(advancedTitle);
  const dataActions = document.createElement("div"), openData = document.createElement("button"), clearData = document.createElement("button");
  dataActions.className = "application-data-actions"; dataActions.hidden = !userData;
  openData.type = clearData.type = "button"; openData.className = "application-data-open"; clearData.className = "application-data-clear"; dataActions.append(openData, clearData);
  for (const item of dialog.querySelectorAll(".application-rules-label, #application-rules-url, .application-rules-help, .application-rules-actions")) advanced.append(item);
  userSettings.className = "application-user-settings"; offset.id = "application-global-offset"; offset.type = "text"; offset.inputMode = "numeric"; offsetLabel.htmlFor = offset.id;
  dialog.querySelector(".application-settings-content").append(userSettings, offsetLabel, offset, offsetHelp, storage, dataActions, advanced, status);
  let statusKey = "", lastError = null, busy = false;
  function showStatus(key, error = null) { statusKey = key; lastError = error; status.hidden = false; status.dataset.error = String(Boolean(error) || key === "applicationPreferenceError"); status.textContent = error ? errorMessage(error) : tr(key); }
  for (const value of APPLICATION_COLOR_SCHEMES) { const option = document.createElement("option"); option.value = value; select.append(option); }
  function refreshLocale() {
    title.textContent = tr("applicationSettings"); close.setAttribute("aria-label", tr("closeApplicationSettings"));
    label.textContent = tr("applicationColorScheme");
    for (const option of select.options) option.textContent = tr({ "ink-blue": "applicationInkBlue", green: "applicationGreen", terracotta: "applicationTerracotta" }[option.value]);
    storage.textContent = tr("applicationUserDataStorage");
    openData.textContent = tr("applicationOpenUserData"); clearData.textContent = tr("applicationClearUserData");
    dialog.querySelector(".application-rules-label").textContent = tr("applicationRulesUrl");
    dialog.querySelector(".application-rules-help").textContent = tr("applicationRulesHelp");
    save.textContent = tr("profileConfigure"); manage.textContent = tr("applicationRulesManage");
    userSettings.textContent = tr("applicationUserSettings"); offsetLabel.textContent = `${tr("settingsGlobalPlaybackOffset")} (${tr("settingsMilliseconds")})`; offsetHelp.textContent = tr("applicationPlaybackHelp");
    advancedTitle.textContent = tr("applicationAdvanced");
    if (!status.hidden) status.textContent = lastError ? errorMessage(lastError) : tr(statusKey);
  }
  async function open() {
    refreshLocale(); select.value = getColorScheme(); dialog.dataset.appColorScheme = getColorScheme(); status.hidden = true;
    offset.value = String(getPlaybackOffset());
    advanced.open = false;
    if (!dialog.open) dialog.showModal();
    url.disabled = true; save.disabled = true;
    try { url.value = (await rules.state()).url; }
    catch (error) { showStatus("", error); }
    finally { url.disabled = false; save.disabled = false; }
  }
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  select.addEventListener("change", () => {
    try { setColorScheme(select.value); dialog.dataset.appColorScheme = getColorScheme(); status.hidden = true; }
    catch { select.value = getColorScheme(); showStatus("applicationPreferenceError"); }
  });
  save.addEventListener("click", async () => {
    if (busy || !url.reportValidity()) return;
    busy = true; save.disabled = true;
    try { await rules.configure(url.value.trim()); url.value = (await rules.state()).url; showStatus("complete"); }
    catch (error) { showStatus("", error); }
    finally { busy = false; save.disabled = false; }
  });
  manage.addEventListener("click", () => { dialog.close(); void openRules(); });
  async function dataAction(action) {
    if (busy) return;
    busy = true; openData.disabled = clearData.disabled = true;
    try { await userData[action](); }
    catch (error) { showStatus("", error); }
    finally { busy = false; openData.disabled = clearData.disabled = false; }
  }
  openData.addEventListener("click", () => dataAction("open"));
  clearData.addEventListener("click", () => dataAction("clear"));
  function commitPlaybackOffset() {
    const source = offset.value.trim(), value = Number(source);
    if (!/^[+-]?\d+$/.test(source) || !Number.isSafeInteger(value)) { offset.value = String(getPlaybackOffset()); showStatus("settingsGlobalPlaybackOffsetInvalid"); return; }
    try { if (value !== getPlaybackOffset()) setPlaybackOffset(value); offset.value = String(getPlaybackOffset()); status.hidden = true; }
    catch { showStatus("applicationPreferenceError"); }
  }
  offset.addEventListener("change", commitPlaybackOffset);
  offset.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitPlaybackOffset(); offset.blur(); } });
  button.hidden = false;
  button.addEventListener("click", open);
  refreshLocale();
  return { open, refreshLocale };
}
