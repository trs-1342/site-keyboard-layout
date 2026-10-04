// SPDX-License-Identifier: GPL-3.0-only
// Helpers shared by the background script, the popup and the settings page.
"use strict";

const NATIVE_HOST = "site_keyboard_layout";
const LAYOUT_RE = /^[A-Za-z0-9_-]{1,32}(\([A-Za-z0-9_-]{1,32}\))?$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/;
const MAX_RULES = 500;

// Everything the extension ever saves. defaultLayout "" means "leave the
// layout alone on sites without a rule".
const DEFAULTS = {
  enabled: true,
  defaultLayout: "",
  rules: [],
  uiLanguage: "auto",
};

function isLayout(value) {
  return typeof value === "string" && LAYOUT_RE.test(value);
}

function isHost(value) {
  return typeof value === "string" && HOST_RE.test(value);
}

// Stored data is never trusted blindly: anything malformed is dropped.
function sanitizeConfig(raw) {
  const cfg = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return cfg;
  if (typeof raw.enabled === "boolean") cfg.enabled = raw.enabled;
  if (raw.defaultLayout === "" || isLayout(raw.defaultLayout)) cfg.defaultLayout = raw.defaultLayout;
  if (typeof raw.uiLanguage === "string" && /^[a-z]{2,8}$/.test(raw.uiLanguage)) cfg.uiLanguage = raw.uiLanguage;
  const seen = new Set();
  cfg.rules = [];
  for (const r of Array.isArray(raw.rules) ? raw.rules : []) {
    if (cfg.rules.length >= MAX_RULES) break;
    if (!r || !isHost(r.host) || !isLayout(r.layout) || seen.has(r.host)) continue;
    seen.add(r.host);
    cfg.rules.push({ host: r.host, layout: r.layout });
  }
  return cfg;
}

async function getConfig() {
  return sanitizeConfig(await browser.storage.local.get(Object.keys(DEFAULTS)));
}

// Pages that are not http(s) (about:newtab etc.) have no host and get the default layout.
function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

// Reduces user input such as "https://Site.com/path" to "site.com"; "" if invalid.
function normalizeHost(text) {
  const t = String(text).trim().toLowerCase();
  if (!t) return "";
  const host = hostOf(t.includes("://") ? t : "https://" + t);
  return isHost(host) ? host : "";
}

// Exact match or subdomain match; the longest (most specific) rule wins.
function matchRule(rules, host) {
  if (!host) return null;
  let best = null;
  for (const r of rules) {
    if (host === r.host || host.endsWith("." + r.host)) {
      if (!best || r.host.length > best.host.length) best = r;
    }
  }
  return best;
}

function layoutFor(cfg, host) {
  const rule = matchRule(cfg.rules, host);
  return rule ? rule.layout : cfg.defaultLayout;
}

// Always resolves; failures come back as { ok: false, error }.
async function nativeCall(msg) {
  try {
    const res = await browser.runtime.sendNativeMessage(NATIVE_HOST, msg);
    if (res && typeof res === "object" && res.ok === true) return res;
    return { ok: false, error: String((res && res.error) || "invalid reply").slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
}

// Layouts configured on this system, as reported by the helper program.
async function getStatus() {
  const res = await nativeCall({ cmd: "status" });
  if (!res.ok) return { ok: false, error: res.error, layouts: [], backend: "" };
  const layouts = [];
  for (const l of Array.isArray(res.layouts) ? res.layouts : []) {
    if (l && isLayout(l.id)) layouts.push({ id: l.id, name: String(l.name || l.id).slice(0, 80) });
  }
  return { ok: true, error: null, layouts, backend: String(res.backend || "").slice(0, 20) };
}

// `extra` are entries placed before the system layouts, e.g. "Don't change".
function fillLayoutSelect(select, layouts, value, extra) {
  select.textContent = "";
  const items = [...(extra || []), ...layouts.map((l) => ({ value: l.id, label: `${l.id} — ${l.name}` }))];
  if (value && !items.some((i) => i.value === value)) {
    items.push({ value, label: `${value} — (${t("notOnSystem")})` });
  }
  for (const i of items) {
    const o = document.createElement("option");
    o.value = i.value;
    o.textContent = i.label;
    select.append(o);
  }
  select.value = value;
}
