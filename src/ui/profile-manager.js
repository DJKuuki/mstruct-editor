/** Profile dialogs receive transport and document capabilities from the runtime. */
export function setupProfileManager({ service, button, enabled, tr, errorMessage, getDocumentIdentity, retryDocument, isReadOnly }) {
  button.hidden = !enabled;
  const node = (tag, text, parent, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    parent.append(element);
    return element;
  };
  const control = (text, parent, primary = false) => {
    const element = node("button", text, parent, primary ? "render-button" : "dialog-secondary");
    element.type = "button";
    return element;
  };
  const field = (text, tag, parent) => {
    const label = node("label", "", parent, "metadata-field");
    const caption = node("span", text, label, "metadata-field-label");
    return { label, caption, input: node(tag, "", label) };
  };
  const shell = (heading) => {
    const modal = node("dialog", "", document.body, "settings-dialog profile-manager");
    modal.setAttribute("aria-label", heading);
    const layout = node("div", "", modal, "settings-form");
    const header = node("header", "", layout, "settings-dialog-header");
    const headingGroup = node("div", "", header);
    node("p", "MSTRUCT", headingGroup, "metadata-kicker");
    const title = node("h2", heading, headingGroup);
    const dismiss = node("button", "×", header, "dialog-close");
    dismiss.type = "button"; dismiss.setAttribute("aria-label", tr("done"));
    dismiss.addEventListener("click", () => modal.close());
    const body = node("div", "", layout, "metadata-fields");
    const footer = node("footer", "", layout, "metadata-dialog-footer");
    return { modal, title, dismiss, body, footer };
  };
  const { modal: dialog, title, dismiss, body, footer } = shell(tr("profileManager"));
  const registrySection = node("section", "", body, "profile-section");
  const registryRow = node("div", "", registrySection, "metadata-url-row");
  const { caption: registryLabel, input: registry } = field(tr("profileRegistry"), "input", registryRow);
  registry.type = "url"; registry.placeholder = "https://…/api/mstruct-profiles";
  const configure = control(tr("profileConfigure"), registryRow);
  const actions = node("div", "", registrySection, "profile-actions");
  const refresh = control(tr("profileRefresh"), actions);
  const imported = control(tr("profileImport"), actions);
  const retryCurrent = control(tr("profileRetry"), actions);
  const newRow = node("div", "", body, "profile-section");
  const { caption: label, input: selection } = field(tr("profileNewChoice"), "select", newRow);
  const selectButton = control(tr("profileUseNew"), newRow);
  const advanced = node("details", "", body, "profile-details"); node("summary", tr("profileBuildDetails"), advanced);
  const detailBody = node("div", "", advanced, "profile-section");
  const currentLabel = node("h3", tr("profileCurrentFile"), detailBody);
  const current = node("p", "", detailBody, "profile-identity");
  const { caption: idLabel, input: profileId } = field(tr("profileId"), "input", detailBody);
  const { caption: hashLabel, input: bundleHash } = field(tr("profileHash"), "input", detailBody);
  const download = control(tr("profileDownload"), detailBody);
  const installedLabel = node("h3", tr("profileInstalledBuilds"), detailBody);
  const installed = node("ul", "", detailBody, "profile-installed");
  const status = node("p", "", body, "profile-status"); status.setAttribute("role", "status");
  const close = control(tr("done"), footer, true); close.addEventListener("click", () => dialog.close());
  let choices = [], busy = false;
  async function render() {
    const state = await service.state();
    title.textContent = tr("profileManager");
    registry.value = state.url;
    const identities = new Map();
    for (const item of state.installed) identities.set(JSON.stringify([item.profileId, item.bundleHash]), { ...item, installed: true });
    for (const line of state.index?.lines ?? []) {
      const identity = { profileId: line.profileId, bundleHash: line.currentHash };
      identities.set(JSON.stringify([identity.profileId, identity.bundleHash]), { ...identity, version: line.version, deprecatedAt: line.deprecatedAt,
        installed: identities.has(JSON.stringify([identity.profileId, identity.bundleHash])) });
    }
    choices = [...new Map([...identities.values()].map((choice) => [choice.profileId, choice])).values()];
    selection.replaceChildren(); installed.replaceChildren();
    for (const choice of identities.values()) if (choice.installed) node("li", `${choice.profileId}\n${choice.bundleHash}`, installed);
    choices.forEach((choice, i) => {
      const option = node("option", `${choice.version} · ${tr(choice.installed ? "profileInstalled" : "profileNeedsDownload")}${choice.deprecatedAt ? ` · ${tr("profileDeprecated")}` : ""}`, selection);
      option.value = String(i);
      if (state.index?.default?.profileId === choice.profileId && state.index.default.bundleHash === choice.bundleHash) option.selected = true;
    });
    const identity = getDocumentIdentity?.();
    current.textContent = identity ? `${identity.profileId}\n${identity.bundleHash}` : tr("profileUnassigned");
    profileId.value ||= identity?.profileId ?? choices[0]?.profileId ?? "";
    bundleHash.value ||= identity?.bundleHash ?? "";
    retryCurrent.disabled = !isReadOnly?.();
    retryCurrent.hidden = !isReadOnly?.();
  }
  async function act(operation) {
    if (busy) return;
    busy = true;
    for (const control of [configure, refresh, imported, selectButton, download]) control.disabled = true;
    try { await operation(); await render(); status.textContent = tr("complete"); }
    catch (error) { status.textContent = errorMessage(error); }
    finally { busy = false; for (const control of [configure, refresh, imported, selectButton, download]) control.disabled = false; }
  }
  configure.addEventListener("click", () => act(() => service.configure(registry.value.trim())));
  refresh.addEventListener("click", () => act(() => service.refresh()));
  imported.addEventListener("click", () => act(() => service.import()));
  retryCurrent.addEventListener("click", () => { dialog.close(); void retryDocument?.(); });
  selectButton.addEventListener("click", () => act(() => service.select(choices[Number(selection.value)])));
  download.addEventListener("click", () => act(() => service.resolve({ profileId: profileId.value.trim(), bundleHash: bundleHash.value.trim(), formatVersion: 1 })));
  async function open() {
    await render();
    const identity = getDocumentIdentity?.();
    profileId.value = identity?.profileId ?? choices[0]?.profileId ?? "";
    bundleHash.value = identity?.bundleHash ?? "";
    status.textContent = "";
    if (!dialog.open) dialog.showModal();
  }
  button.addEventListener("click", () => { void open(); });

  async function recovery(source, initial) {
    const { modal: prompt, body: promptBody, footer: buttons } = shell(tr(initial.assignmentRequired ? "profileAssign" : "profileUnavailable"));
    const message = node("p", "", promptBody, "profile-message");
    const { label: pickLabel, input: pick } = field(tr("profileNewChoice"), "select", promptBody);
    let options;
    async function loadOptions() {
      options = (await service.state()).installed;
      pick.replaceChildren();
      options.forEach((identity, i) => { const option = node("option", identity.version, pick); option.value = String(i); });
    }
    await loadOptions();
    pickLabel.hidden = !initial.assignmentRequired;
    const { input: raw } = field(tr("profileSource"), "textarea", promptBody);
    raw.readOnly = true; raw.value = source;
    const manage = control(tr("profileManager"), buttons); manage.hidden = !enabled;
    const readonly = control(tr("profileReadOnly"), buttons);
    const retry = control(tr(initial.assignmentRequired ? "profileAssign" : "profileRetry"), buttons, true);
    let result = initial, working = false;
    const finish = (value) => { result = value; prompt.close(); };
    readonly.addEventListener("click", () => finish({ source, error: initial.error ?? { code: "profile-assignment-required" } }));
    manage.addEventListener("click", async () => { await open(); await new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true })); await loadOptions(); });
    retry.addEventListener("click", async () => {
      if (working) return;
      working = true; retry.disabled = true;
      try {
        if (initial.assignmentRequired) {
          const target = await service.resolve({ ...options[Number(pick.value)], formatVersion: 1 });
          const assigned = await service.assign(source, target);
          if (assigned.ok) finish({ source: assigned.source, changed: true });
          else message.textContent = assigned.errors.map(errorMessage).join("\n");
        } else {
          const resolved = await service.prepareOpen(source);
          if (!resolved.error && !resolved.assignmentRequired) finish(resolved);
          else message.textContent = errorMessage(resolved.error ?? { code: "profile-assignment-required" });
        }
      } catch (error) { message.textContent = errorMessage(error); }
      finally { working = false; retry.disabled = false; }
    });
    message.textContent = initial.error ? errorMessage(initial.error) : tr("profileAssignmentHelp");
    const closed = new Promise((resolve) => prompt.addEventListener("close", resolve, { once: true }));
    prompt.showModal();
    await closed;
    prompt.remove();
    return result.assignmentRequired ? { source, error: { code: "profile-assignment-required" } } : result;
  }
  const labels = [[title, "profileManager"], [registryLabel, "profileRegistry"], [configure, "profileConfigure"], [refresh, "profileRefresh"],
    [imported, "profileImport"], [retryCurrent, "profileRetry"], [label, "profileNewChoice"], [selectButton, "profileUseNew"],
    [advanced.querySelector("summary"), "profileBuildDetails"], [currentLabel, "profileCurrentFile"], [installedLabel, "profileInstalledBuilds"],
    [idLabel, "profileId"], [hashLabel, "profileHash"], [download, "profileDownload"], [close, "done"]];
  return { open, updateLocale() {
    for (const [element, key] of labels) element.textContent = tr(key);
    dismiss.setAttribute("aria-label", tr("done"));
    dialog.setAttribute("aria-label", tr("profileManager"));
    if (dialog.open) void render();
  }, async prepareOpen(source) {
    const result = await service.prepareOpen(source);
    return result.assignmentRequired || result.error ? recovery(source, result) : result;
  } };
}
