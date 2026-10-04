// SPDX-License-Identifier: GPL-3.0-only
// Looks at the active tab of the focused window and tells the helper program
// which keyboard layout it needs.
//
// The helper changes the layout of whatever window has focus, so nothing is
// sent while Firefox is in the background; otherwise another application's
// layout would change.
//
// A layout is applied only when the context (tab + target layout) changes, so
// a manual layout change is not overwritten while you stay on the same tab.
"use strict";

const COLOR_ACTIVE = "#b3202a";
const COLOR_IDLE = "#666666";
const COLOR_PAUSED = "#aa6600";
const COLOR_ERROR = "#000000";

let queue = Promise.resolve();

function schedule(force) {
  queue = queue.then(() => evaluate(force)).catch((e) => console.error("site-keyboard-layout:", e.message));
  return queue;
}

async function setBadge(text, color) {
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color });
}

// Session state lives in memory only and is gone when Firefox closes:
//   applied: { windowId: "tabId|layout" }  - what was last applied per window
//   paused:  [host]                        - sites paused from the popup
async function getSession() {
  const s = await browser.storage.session.get({ applied: {}, paused: [] });
  return {
    applied: s.applied && typeof s.applied === "object" ? s.applied : {},
    paused: Array.isArray(s.paused) ? s.paused.filter(isHost) : [],
  };
}

async function evaluate(force) {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    await browser.storage.session.set({ applied: {} });
    return setBadge("off", COLOR_IDLE);
  }

  const win = await browser.windows.getLastFocused();
  if (!win.focused) return;
  const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
  if (!tab) return;

  const host = hostOf(tab.url);
  const state = await getSession();
  const paused = host !== "" && state.paused.includes(host);
  const layout = paused ? "" : layoutFor(cfg, host);

  if (!layout) {
    delete state.applied[win.id];
    await browser.storage.session.set({ applied: state.applied });
    return paused ? setBadge("||", COLOR_PAUSED) : setBadge("", COLOR_IDLE);
  }

  await setBadge(layout.replace(/\(.*/, "").slice(0, 4), COLOR_ACTIVE);

  const key = `${tab.id}|${layout}`;
  if (!force && state.applied[win.id] === key) return;

  const res = await nativeCall({ cmd: "set", layout });
  if (!res.ok) return setBadge("!", COLOR_ERROR);
  state.applied[win.id] = key;
  await browser.storage.session.set({ applied: state.applied });
}

browser.tabs.onActivated.addListener(() => schedule(false));
browser.tabs.onUpdated.addListener(() => schedule(false), { properties: ["url"] });
browser.windows.onFocusChanged.addListener((id) => {
  if (id !== browser.windows.WINDOW_ID_NONE) schedule(false);
});
browser.windows.onRemoved.addListener(async (id) => {
  const state = await getSession();
  delete state.applied[id];
  await browser.storage.session.set({ applied: state.applied });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" || (area === "session" && changes.paused)) schedule(false);
});

browser.commands.onCommand.addListener(async (name) => {
  if (name !== "toggle-enabled") return;
  const cfg = await getConfig();
  await browser.storage.local.set({ enabled: !cfg.enabled });
});

browser.runtime.onStartup.addListener(() => schedule(true));
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    browser.tabs.create({ url: browser.runtime.getURL("options.html?welcome=1") });
  }
  schedule(true);
});
