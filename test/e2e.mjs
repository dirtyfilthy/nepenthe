// End-to-end test in real Firefox via WebDriver BiDi (no extra dependencies).
// Uses a throwaway profile, local test sites (*.test mapped to 127.0.0.1) and a
// 1-minute limit, so it takes about 90 seconds.
// Usage: FIREFOX=/path/to/firefox node test/e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const FIREFOX = process.env.FIREFOX || "/Applications/Firefox.app/Contents/MacOS/firefox";
const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const UUID = "6e0c0b55-0e0e-4e9e-9a5e-6e9e9e9e0001";
const BIDI_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// --- test sites -------------------------------------------------------------
// Both pages load /asset.js, which may be cached for a day. Counting how often the
// server sees it per host tells us whether Firefox served it from cache.
const ASSET = `<script src="/asset.js"></script>`;
const PAGE = `<!doctype html><title>site</title>${ASSET}<script>
localStorage.setItem("k", "v-" + location.host);
const r = indexedDB.open("nepenthe-test", 1);
r.onupgradeneeded = () => r.result.createObjectStore("s");
r.onsuccess = () => { document.title = "ready"; };
</script>`;
const assetHits = {};
const server = createServer((req, res) => {
  if (req.url === "/asset.js") {
    const host = req.headers.host.split(".")[0];
    assetHits[host] = (assetHits[host] || 0) + 1;
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "public, max-age=86400" });
    return res.end("/* cached asset */");
  }
  if (req.url === "/form") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><form action="/check"><input name="q"></form>`);
  }
  const headers = { "content-type": "text/html" };
  if (req.url === "/") headers["set-cookie"] = "sid=1; Max-Age=86400; Path=/";
  res.writeHead(200, headers);
  res.end(req.url === "/" ? PAGE : `<!doctype html><title>check</title>${ASSET}`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const site = (name, path = "/") => `http://${name}.test:${PORT}${path}`;

// --- Firefox ----------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "nepenthe-e2e-"));
const prefs = {
  "network.dns.localDomains": "old.test,fresh.test,open.test,night.test",
  "network.proxy.type": 0,
  "dom.security.https_first": false,
  "dom.security.https_first_schemeless": false,
  "extensions.webextensions.uuids": JSON.stringify({ [JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf8")).browser_specific_settings.gecko.id]: UUID }),
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "browser.startup.homepage_override.mstone": "ignore",
};
writeFileSync(join(profile, "user.js"),
  Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
const ff = spawn(FIREFOX, ["--headless", "--no-remote", "--profile", profile, `--remote-debugging-port=${BIDI_PORT}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });
let stderr = "";
ff.stderr.on("data", (d) => (stderr += d));

function cleanup() {
  ff.kill();
  server.close();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000);
}

// --- BiDi client ------------------------------------------------------------
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(500);
  ws = await new Promise((resolve) => {
    const s = new WebSocket(`ws://127.0.0.1:${BIDI_PORT}/session`);
    s.onopen = () => resolve(s);
    s.onerror = () => resolve(null);
  });
}
if (!ws) { cleanup(); throw new Error("Firefox BiDi never came up\n" + stderr); }
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.type === "error" ? reject(new Error(`${m.error}: ${m.message}`)) : resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function newTab(url) {
  const { context } = await send("browsingContext.create", { type: "tab" });
  if (url) await send("browsingContext.navigate", { context, url, wait: "complete" });
  return context;
}
// Evaluates an async expression in a tab and returns its JSON-decoded result.
async function evalIn(context, expr) {
  const r = await send("script.evaluate", {
    expression: `(async () => JSON.stringify((await (${expr})) ?? null))()`,
    target: { context }, awaitPromise: true,
  });
  if (r.type === "exception") throw new Error(r.exceptionDetails.text);
  return JSON.parse(r.result.value);
}
async function visit(name) {
  const ctx = await newTab(site(name));
  for (let i = 0; i < 50 && (await evalIn(ctx, "document.title")) !== "ready"; i++) await sleep(100);
  return ctx;
}
async function inspect(name) {
  const ctx = await newTab(site(name, "/check"));
  const r = await evalIn(ctx, `(async () => ({
    cookie: document.cookie,
    ls: localStorage.getItem("k"),
    idb: (await indexedDB.databases()).map(d => d.name),
  }))()`);
  await send("browsingContext.close", { context: ctx });
  return r;
}

// Counts saved form history by reading a copy of the profile's database.
function formHistoryCount() {
  const dir = mkdtempSync(join(tmpdir(), "nepenthe-fh-"));
  for (const f of ["formhistory.sqlite", "formhistory.sqlite-wal"]) {
    try { copyFileSync(join(profile, f), join(dir, f)); } catch {}
  }
  try {
    return Number(execFileSync("sqlite3", [join(dir, "formhistory.sqlite"), "select count(*) from moz_formhistory"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
  } catch {
    return 0; // no database yet means nothing saved
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await send("session.new", { capabilities: {} });
  const { extension } = await send("webExtension.install", { extensionData: { type: "path", path: EXT_DIR } });
  log("installed", extension);

  // BiDi can't navigate to moz-extension:// URLs, but the extension opens its
  // own options page on install; find that tab.
  let opt;
  for (let i = 0; i < 50 && !opt; i++) {
    await sleep(200);
    const { contexts } = await send("browsingContext.getTree", {});
    opt = contexts.find((c) => c.url.startsWith(`moz-extension://${UUID}/`))?.context;
  }
  assert.ok(opt, "options page should open on install");
  await evalIn(opt, `browser.storage.local.set({ settings: { enabled: false, amount: 1, unit: "minutes" } })`);

  // Submitting a form makes Firefox save what was typed, like a real search.
  async function submitForm(name) {
    const formTab = await newTab(site(name, "/form"));
    await evalIn(formTab, `document.querySelector("input").focus()`);
    const keys = [..."nepenthe test"].flatMap((value) => [{ type: "keyDown", value }, { type: "keyUp", value }]);
    keys.push({ type: "keyDown", value: "\uE007" }, { type: "keyUp", value: "\uE007" }); // Enter submits
    await send("input.performActions", { context: formTab, actions: [{ type: "key", id: "kbd", actions: keys }] });
    let saved = 0;
    for (let i = 0; i < 50 && !saved; i++) { await sleep(200); saved = formHistoryCount(); }
    await send("browsingContext.close", { context: formTab });
    return saved;
  }

  log("clear-form-history button");
  const saved = await submitForm("fresh");
  assert.ok(saved > 0, "form history saved");
  // BiDi can't answer dialogs on extension pages, so stand in for confirm(): record it and say OK.
  await evalIn(opt, `(window.confirmed = [], window.confirm = (m) => (window.confirmed.push(m), true), true)`);
  await evalIn(opt, `document.getElementById("clearForms").click()`);
  const [message] = await evalIn(opt, `window.confirmed`);
  assert.match(message, /search boxes and web forms/);
  let status = "";
  for (let i = 0; i < 50 && !status; i++) { await sleep(100); status = await evalIn(opt, `document.getElementById("clearFormsStatus").textContent`); }
  assert.equal(status, "Cleared.");
  let left = saved;
  for (let i = 0; i < 25 && left; i++) { await sleep(200); left = formHistoryCount(); }
  assert.equal(left, 0, "form history cleared");

  log("visiting old.test (then closing it) and open.test (left open)");
  await send("browsingContext.close", { context: await visit("old") });
  await visit("open");

  log("waiting 70s so both age past the 1 minute limit");
  await sleep(70_000);
  await send("browsingContext.close", { context: await visit("fresh") });

  const preview = await evalIn(opt, `browser.runtime.sendMessage({ type: "preview" })`);
  log("preview:", JSON.stringify(preview.sites), JSON.stringify(preview.counts));
  const staleSites = preview.sites.map((s) => s.site);
  assert.ok(staleSites.includes("old.test"), "old.test should be stale");
  assert.ok(!staleSites.includes("fresh.test"), "fresh.test was just visited");
  assert.ok(!staleSites.includes("open.test"), "open.test is open in a tab");

  const result = await evalIn(opt, `browser.runtime.sendMessage({ type: "sweep" })`);
  log("sweep:", JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result.failures));

  const hist = await evalIn(opt, `browser.history.search({ text: "", startTime: 0, maxResults: 1000 }).then(h => h.map(x => x.url))`);
  log("history now:", hist.join(" "));
  assert.ok(!hist.some((u) => u.includes("old.test")), "old.test history gone");
  assert.ok(!hist.some((u) => u.includes("open.test")), "open.test's old visit expired too");
  assert.ok(hist.some((u) => u.includes("fresh.test")), "fresh.test history kept");

  const cookies = await evalIn(opt, `browser.cookies.getAll({ firstPartyDomain: null, partitionKey: {} }).then(c => c.map(x => x.domain))`);
  log("cookies now:", cookies.join(" "));
  assert.deepEqual(cookies.sort(), ["fresh.test", "open.test"]);

  const stored = await evalIn(opt, `browser.storage.local.get()`);
  assert.ok(!JSON.stringify(stored).includes(".test"), "extension storage must not record sites");

  const oldData = await inspect("old");
  const freshData = await inspect("fresh");
  const openData = await inspect("open");
  log("old.test:", JSON.stringify(oldData), "fresh.test:", JSON.stringify(freshData), "open.test:", JSON.stringify(openData));
  assert.deepEqual(oldData, { cookie: "", ls: null, idb: [] });
  assert.equal(freshData.cookie, "sid=1");
  assert.equal(freshData.ls, `v-fresh.test:${PORT}`);
  assert.deepEqual(freshData.idb, ["nepenthe-test"]);
  assert.equal(openData.ls, `v-open.test:${PORT}`);

  // Each host fetched asset.js once on the first visit. A second fetch means its cache was cleared.
  log("asset.js fetches per host:", JSON.stringify(assetHits));
  assert.equal(assetHits.old, 2, "old.test's cached asset should be gone");
  // Per-host cache clearing doesn't work in Firefox, so the whole cache is cleared.
  assert.equal(assetHits.fresh, 2, "whole cache is cleared when any site expires");

  log("bad night: revisit fresh.test, then visit night.test for the first time");
  const since = Date.now();
  await sleep(1500);
  await send("browsingContext.close", { context: await visit("fresh") });
  assert.ok((await submitForm("night")) > 0, "form history saved tonight");
  const nightTab = await visit("night");

  // The button asks first; say no and check nothing happened.
  await evalIn(opt, `(window.confirmed = [], window.confirm = (m) => (window.confirmed.push(m), false), true)`);
  await evalIn(opt, `document.getElementById("badNight").click()`);
  let asked = [];
  for (let i = 0; i < 50 && !asked.length; i++) { await sleep(100); asked = await evalIn(opt, `window.confirmed`); }
  assert.match(asked[0], /^Forget everything since .*night\.test.*Still open in a tab: night\.test/s);
  assert.ok((await evalIn(opt, `browser.cookies.getAll({ domain: "night.test" })`)).length, "cancelled: night.test cookie kept");

  const nightPreview = await evalIn(opt, `browser.runtime.sendMessage({ type: "badNightPreview", since: ${since} })`);
  log("bad night preview:", JSON.stringify(nightPreview.sites), JSON.stringify(nightPreview.counts));
  assert.deepEqual(nightPreview.sites.map((s) => s.site), ["night.test"], "fresh.test was visited before, so it's kept");
  assert.deepEqual(nightPreview.openSites, ["night.test"]);
  await send("browsingContext.close", { context: nightTab });

  const nightResult = await evalIn(opt, `browser.runtime.sendMessage({ type: "badNight", since: ${since} })`);
  log("bad night:", JSON.stringify(nightResult));
  assert.deepEqual(nightResult.failures, {});

  const tonight = await evalIn(opt, `browser.history.search({ text: "", startTime: ${since}, maxResults: 1000 }).then(h => h.map(x => x.url))`);
  assert.deepEqual(tonight, [], "no visits since then");
  const histAfter = await evalIn(opt, `browser.history.search({ text: "", startTime: 0, maxResults: 1000 }).then(h => h.map(x => x.url))`);
  assert.ok(histAfter.some((u) => u.includes("fresh.test")), "fresh.test's earlier visit kept");
  assert.ok(!histAfter.some((u) => u.includes("night.test")), "night.test history gone");
  const cookiesAfter = await evalIn(opt, `browser.cookies.getAll({ firstPartyDomain: null, partitionKey: {} }).then(c => c.map(x => x.domain))`);
  assert.deepEqual(cookiesAfter.sort(), ["fresh.test", "open.test"]);
  let formLeft = 1;
  for (let i = 0; i < 25 && formLeft; i++) { await sleep(200); formLeft = formHistoryCount(); }
  assert.equal(formLeft, 0, "tonight's form history gone");
  assert.ok(!JSON.stringify(await evalIn(opt, `browser.storage.local.get()`)).includes("night"), "bad night isn't recorded");
  const nightData = await inspect("night");
  log("night.test:", JSON.stringify(nightData));
  assert.deepEqual(nightData, { cookie: "", ls: null, idb: [] });
  assert.equal((await inspect("fresh")).cookie, "sid=1");

  log("PASS");
} catch (e) {
  log("FAIL", e.stack || e);
  process.exitCode = 1;
} finally {
  ws.close();
  cleanup();
}
