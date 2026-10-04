// SPDX-License-Identifier: GPL-3.0-only
// Tests for the pure helpers in extension/common.js. Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "common.js"), "utf8");
const ctx = vm.createContext({ URL });
vm.runInContext(
  source + "\n;globalThis.api = { sanitizeConfig, hostOf, normalizeHost, matchRule, layoutFor, isLayout, isHost, MAX_RULES };",
  ctx,
);
const { sanitizeConfig, hostOf, normalizeHost, matchRule, layoutFor, isLayout, isHost, MAX_RULES } = ctx.api;
const plain = (v) => JSON.parse(JSON.stringify(v));

test("hostOf only returns hosts for http(s) pages", () => {
  assert.equal(hostOf("https://Web.WhatsApp.com/chat?x=1"), "web.whatsapp.com");
  assert.equal(hostOf("http://example.org:8080/"), "example.org");
  assert.equal(hostOf("about:newtab"), "");
  assert.equal(hostOf("file:///etc/passwd"), "");
  assert.equal(hostOf("moz-extension://abc/options.html"), "");
  assert.equal(hostOf(undefined), "");
});

test("normalizeHost cleans user input and rejects junk", () => {
  assert.equal(normalizeHost("  https://Example.com/a/b  "), "example.com");
  assert.equal(normalizeHost("example.com"), "example.com");
  assert.equal(normalizeHost("münchen.de"), "xn--mnchen-3ya.de");
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost("javascript:alert(1)"), "");
  assert.equal(normalizeHost("<script>"), "");
  assert.equal(normalizeHost("a b"), "");
});

test("layout and host validators", () => {
  for (const ok of ["us", "tr", "tr(f)", "en-US", "en-US(04090409)"]) assert.ok(isLayout(ok), ok);
  for (const bad of ["", "us tr", "us;ls", "--x(", "a".repeat(40), 1, null, "tr()"]) assert.ok(!isLayout(bad), String(bad));
  assert.ok(isHost("web.whatsapp.com"));
  assert.ok(!isHost("Web.WhatsApp.com"));
  assert.ok(!isHost(".com"));
  assert.ok(!isHost("a..b"));
});

test("matchRule prefers the most specific rule", () => {
  const rules = [
    { host: "whatsapp.com", layout: "us" },
    { host: "web.whatsapp.com", layout: "tr" },
  ];
  assert.equal(matchRule(rules, "web.whatsapp.com").layout, "tr");
  assert.equal(matchRule(rules, "faq.whatsapp.com").layout, "us");
  assert.equal(matchRule(rules, "notwhatsapp.com"), null);
  assert.equal(matchRule(rules, ""), null);
  assert.equal(layoutFor({ rules, defaultLayout: "de" }, "example.org"), "de");
});

test("sanitizeConfig drops anything malformed", () => {
  const cfg = plain(sanitizeConfig({
    enabled: "yes",
    defaultLayout: "us; rm",
    uiLanguage: "../../x",
    rules: [
      { host: "example.com", layout: "tr" },
      { host: "example.com", layout: "us" },
      { host: "EXAMPLE.org", layout: "tr" },
      { host: "ok.org", layout: "bad layout" },
      null,
      "x",
      { host: "fine.org", layout: "tr(f)", extra: "ignored" },
    ],
    unknownKey: 1,
  }));
  assert.deepEqual(cfg, {
    enabled: true,
    defaultLayout: "",
    rules: [
      { host: "example.com", layout: "tr" },
      { host: "fine.org", layout: "tr(f)" },
    ],
    uiLanguage: "auto",
  });
  assert.deepEqual(plain(sanitizeConfig(null)).rules, []);
  assert.deepEqual(plain(sanitizeConfig({ rules: "nope" })).rules, []);
});

test("sanitizeConfig caps the number of rules", () => {
  const rules = Array.from({ length: MAX_RULES + 50 }, (_, i) => ({ host: `h${i}.example`, layout: "us" }));
  assert.equal(sanitizeConfig({ rules }).rules.length, MAX_RULES);
});
