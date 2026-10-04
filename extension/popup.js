// SPDX-License-Identifier: GPL-3.0-only
"use strict";

const $ = (id) => document.getElementById(id);

async function getPaused() {
  const { paused } = await browser.storage.session.get({ paused: [] });
  return Array.isArray(paused) ? paused.filter(isHost) : [];
}

async function render() {
  const [cfg, paused, [tab], status, commands] = await Promise.all([
    getConfig(),
    getPaused(),
    browser.tabs.query({ active: true, currentWindow: true }),
    getStatus(),
    browser.commands.getAll(),
  ]);
  setLanguage(cfg.uiLanguage);
  localizeDocument();

  const host = tab ? hostOf(tab.url) : "";

  $("enabled").checked = cfg.enabled;
  $("enabled").onchange = () => browser.storage.local.set({ enabled: $("enabled").checked });
  $("shortcut").textContent = commands.find((c) => c.name === "toggle-enabled")?.shortcut || "";

  $("site").hidden = !host;
  $("nosite").hidden = !!host;

  if (host) {
    $("host").textContent = host;

    const exact = cfg.rules.find((r) => r.host === host);
    const inherited = matchRule(cfg.rules.filter((r) => r.host !== host), host);
    const fallback = inherited
      ? t("useInherited", inherited.layout, inherited.host)
      : t("useDefault", cfg.defaultLayout || t("dontChange"));
    fillLayoutSelect($("layout"), status.layouts, exact ? exact.layout : "", [{ value: "", label: fallback }]);
    $("layout").onchange = async () => {
      const rules = cfg.rules.filter((r) => r.host !== host);
      const value = $("layout").value;
      if (isLayout(value) && isHost(host) && rules.length < MAX_RULES) rules.push({ host, layout: value });
      await browser.storage.local.set({ rules });
      render();
    };

    // Nothing about a private window is kept, not even in memory.
    $("pauseBox").hidden = tab.incognito || !isHost(host);
    const isPaused = paused.includes(host);
    $("pause").textContent = isPaused ? t("resume") : t("pause");
    $("pause").classList.toggle("active", isPaused);
    $("pause").onclick = async () => {
      const next = isPaused ? paused.filter((h) => h !== host) : [...paused, host];
      await browser.storage.session.set({ paused: next });
      render();
    };
  }

  $("error").hidden = status.ok;
  $("error").textContent = status.ok ? "" : t("helperError", status.error);
}

$("options").onclick = () => {
  browser.runtime.openOptionsPage();
  window.close();
};

render();
