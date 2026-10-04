// SPDX-License-Identifier: GPL-3.0-only
// Settings page. Opened with ?welcome=1 right after installation, in which
// case it doubles as the setup screen.
"use strict";

const $ = (id) => document.getElementById(id);
const COMMAND = "toggle-enabled";

let welcome = new URLSearchParams(location.search).has("welcome");
let helper = null; // null while the helper program is being checked

function showError(id, msg) {
  $(id).hidden = !msg;
  $(id).textContent = msg || "";
}

function renderHelper() {
  const el = $("helperStatus");
  el.className = "status";
  $("helperHelp").hidden = true;
  if (!helper) {
    el.textContent = t("helperChecking");
    return;
  }
  if (helper.ok) {
    const many = helper.layouts.length > 1;
    el.classList.add(many ? "ok" : "bad");
    el.textContent = many
      ? t("helperOk", helper.backend, helper.layouts.map((l) => l.id).join(", "))
      : t("helperNoLayouts", helper.backend);
    return;
  }
  el.classList.add("bad");
  el.textContent = t("helperMissing");
  $("helperDetails").textContent = t("helperDetails", helper.error);
  $("helperHelp").hidden = false;
}

async function render() {
  const cfg = await getConfig();
  setLanguage(cfg.uiLanguage);
  localizeDocument();

  $("title").textContent = t(welcome ? "welcomeTitle" : "settingsTitle");
  document.title = t("settingsTitle");
  $("welcome").hidden = !welcome;
  $("doneRow").hidden = !welcome;

  const lang = $("language");
  lang.textContent = "";
  for (const [value, label] of [["auto", t("langAuto")], ...Object.entries(LANGUAGES)]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    lang.append(o);
  }
  lang.value = Object.hasOwn(LANGUAGES, cfg.uiLanguage) ? cfg.uiLanguage : "auto";

  renderHelper();

  const layouts = helper ? helper.layouts : [];
  $("enabled").checked = cfg.enabled;
  fillLayoutSelect($("defaultLayout"), layouts, cfg.defaultLayout, [{ value: "", label: t("dontChange") }]);
  const keep = $("newLayout").value;
  fillLayoutSelect($("newLayout"), layouts, layouts.some((l) => l.id === keep) ? keep : layouts[0]?.id || "");

  const box = $("rules");
  box.textContent = "";
  const sorted = [...cfg.rules].sort((a, b) => a.host.localeCompare(b.host));
  for (const rule of sorted) {
    const row = document.createElement("div");
    row.className = "row";

    const host = document.createElement("span");
    host.className = "host grow";
    host.textContent = rule.host;

    const select = document.createElement("select");
    fillLayoutSelect(select, layouts, rule.layout);
    select.onchange = () => {
      if (!isLayout(select.value)) return;
      const rules = cfg.rules.map((r) => (r.host === rule.host ? { host: r.host, layout: select.value } : r));
      browser.storage.local.set({ rules });
    };

    const del = document.createElement("button");
    del.textContent = t("remove");
    del.onclick = () => browser.storage.local.set({ rules: cfg.rules.filter((r) => r.host !== rule.host) });

    row.append(host, select, del);
    box.append(row);
  }
  if (!cfg.rules.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = t("noRules");
    box.append(empty);
  }
}

async function checkHelper() {
  helper = null;
  renderHelper();
  helper = await getStatus();

  // First run: start from the layout the system puts first instead of "Don't change".
  if (welcome && helper.ok && helper.layouts.length) {
    const stored = await browser.storage.local.get("defaultLayout");
    if (stored.defaultLayout === undefined) {
      await browser.storage.local.set({ defaultLayout: helper.layouts[0].id });
      return; // the storage listener re-renders
    }
  }
  render();
}

$("language").onchange = () => browser.storage.local.set({ uiLanguage: $("language").value });
$("enabled").onchange = () => browser.storage.local.set({ enabled: $("enabled").checked });
$("defaultLayout").onchange = () => {
  const value = $("defaultLayout").value;
  if (value === "" || isLayout(value)) browser.storage.local.set({ defaultLayout: value });
};
$("retry").onclick = checkHelper;
$("done").onclick = () => {
  welcome = false;
  history.replaceState(null, "", location.pathname);
  render();
};

async function addRule() {
  const host = normalizeHost($("newHost").value);
  const layout = $("newLayout").value;
  if (!host) return showError("ruleError", t("invalidHost"));
  if (!isLayout(layout)) return;
  const cfg = await getConfig();
  const rules = cfg.rules.filter((r) => r.host !== host);
  if (rules.length >= MAX_RULES) return showError("ruleError", t("tooManyRules"));
  rules.push({ host, layout });
  await browser.storage.local.set({ rules });
  $("newHost").value = "";
  showError("ruleError", "");
}
$("add").onclick = addRule;
$("newHost").onkeydown = (e) => {
  if (e.key === "Enter") addRule();
};

// --- shortcut ---

async function renderShortcut() {
  const cmd = (await browser.commands.getAll()).find((c) => c.name === COMMAND);
  $("shortcut").value = cmd?.shortcut || "";
}

const KEY_NAMES = {
  " ": "Space", ",": "Comma", ".": "Period",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  Insert: "Insert", Delete: "Delete",
};

function keyName(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  return KEY_NAMES[e.key] || null;
}

$("shortcut").onkeydown = async (e) => {
  if (e.key === "Tab") return;
  e.preventDefault();
  if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) return;

  const key = keyName(e);
  if (!key) return showError("shortcutError", t("shortcutBadKey"));

  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const shortcut = [...mods, key].join("+");

  try {
    await browser.commands.update({ name: COMMAND, shortcut });
    showError("shortcutError", "");
  } catch (err) {
    showError("shortcutError", t("shortcutRejected", shortcut, err.message));
  }
  renderShortcut();
};

$("shortcutReset").onclick = async () => {
  await browser.commands.reset(COMMAND);
  showError("shortcutError", "");
  renderShortcut();
};
$("shortcutClear").onclick = async () => {
  await browser.commands.update({ name: COMMAND, shortcut: "" });
  showError("shortcutError", "");
  renderShortcut();
};

// --- start ---

browser.storage.onChanged.addListener((_, area) => {
  if (area === "local") render();
});

const manifest = browser.runtime.getManifest();
const RAW = `https://raw.githubusercontent.com/trs-1342/site-keyboard-layout/v${manifest.version}/native`;
$("guide").href = manifest.homepage_url + "#installation";
const RELEASE = `${manifest.homepage_url}/releases/download/v${manifest.version}`;
$("dlRpm").href = `${RELEASE}/site-keyboard-layout-helper.rpm`;
$("dlDeb").href = `${RELEASE}/site-keyboard-layout-helper.deb`;
$("dlWin").href = `${RELEASE}/site-keyboard-layout-setup.cmd`;
$("cmdLinux").textContent = `curl -fsSL ${RAW}/install.sh | sudo bash`;
$("cmdWindows").textContent = `irm ${RAW}/install.ps1 | iex`;
for (const button of document.querySelectorAll("button.copy")) {
  button.onclick = async () => {
    await navigator.clipboard.writeText($(button.dataset.copy).textContent);
    button.textContent = t("copied");
    setTimeout(() => (button.textContent = t("copy")), 1500);
  };
}
browser.runtime.getPlatformInfo().then(({ os }) => {
  for (const id of ["howLinux", "rowLinux", "rowDownloadLinux"]) $(id).hidden = os === "win";
  for (const id of ["howWindows", "rowWindows", "rowDownloadWindows"]) $(id).hidden = os !== "win";
});
render();
renderShortcut();
checkHelper();
