// End-to-end test in real Firefox via WebDriver BiDi (no extra dependencies).
// Uses a throwaway profile, local test sites (*.test mapped to 127.0.0.1) and a
// 1-minute limit, so it takes about 90 seconds.
// Usage: FIREFOX=/path/to/firefox node test/e2e.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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
  "network.dns.localDomains": "old.test,fresh.test,open.test",
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

  log("PASS");
} catch (e) {
  log("FAIL", e.stack || e);
  process.exitCode = 1;
} finally {
  ws.close();
  cleanup();
}
