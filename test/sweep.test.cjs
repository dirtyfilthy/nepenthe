const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/psl-data.js");
const Domain = require("../src/domain.js");
require("../src/settings.js");
const Sweep = require("../src/sweep.js");

const DAY = 86400e3;
const NOW = Date.UTC(2026, 10, 17);

test("baseDomain groups by registrable domain", () => {
  assert.equal(Domain.baseDomain("www.example.com"), "example.com");
  assert.equal(Domain.baseDomain(".accounts.google.com"), "google.com");
  assert.equal(Domain.baseDomain("a.b.example.co.uk"), "example.co.uk");
  assert.equal(Domain.baseDomain("alice.github.io"), "alice.github.io");
  assert.equal(Domain.baseDomain("localhost"), "localhost");
  assert.equal(Domain.baseDomain("192.168.1.1"), "192.168.1.1");
  assert.equal(Domain.siteOfUrl("about:blank"), null);
  assert.equal(Domain.siteOfUrl("https://Docs.Example.com:8443/x"), "example.com");
});

function cookie(domain, extra = {}) {
  return { name: "c", domain, path: "/", secure: true, storeId: "firefox-default", firstPartyDomain: "", ...extra };
}

function fakeApi({ history = [], tabs = [], cookies = [], downloads = [], closed = [] } = {}) {
  const calls = { browsingData: [], cacheCleared: [], cookiesRemoved: [], deleteRange: [], erased: [], forgotTabs: [], forgotWindows: [] };
  const api = {
    calls,
    history: {
      async search({ startTime = 0, endTime = Infinity }) {
        return history.filter((h) => h.visits.some((v) => v >= startTime && v <= endTime))
          .map((h) => ({ url: h.url, lastVisitTime: Math.max(...h.visits) }));
      },
      async deleteRange(r) { calls.deleteRange.push(r); },
    },
    tabs: { async query() { return tabs.map((url) => ({ url })); } },
    cookies: {
      async getAllCookieStores() { return [{ id: "firefox-default" }, { id: "firefox-container-1" }]; },
      async getAll({ storeId, firstPartyDomain, partitionKey }) {
        assert.equal(firstPartyDomain, null);
        assert.deepEqual(partitionKey, {});
        return cookies.filter((c) => c.storeId === storeId);
      },
      async remove(d) { calls.cookiesRemoved.push(d); return d; },
    },
    browsingData: {
      async remove(opts, types) { calls.browsingData.push({ hostnames: opts.hostnames, types }); },
      async removeCache(opts) { calls.cacheCleared.push(opts); },
    },
    downloads: {
      async search({ startedBefore }) { return downloads.filter((d) => d.startTime < startedBefore); },
      async erase({ id }) { calls.erased.push(id); },
    },
    sessions: {
      async getRecentlyClosed() { return closed; },
      async forgetClosedTab(w, s) { calls.forgotTabs.push([w, s]); },
      async forgetClosedWindow(s) { calls.forgotWindows.push(s); },
    },
  };
  return api;
}

const settings = { enabled: true, amount: 7, unit: "days" };

test("stale sites lose cookies and site data; active sites keep them", async () => {
  const api = fakeApi({
    history: [
      { url: "https://www.old.com/page", visits: [NOW - 30 * DAY] },
      { url: "http://dev.old.com:8080/", visits: [NOW - 20 * DAY] },
      { url: "https://news.active.com/", visits: [NOW - 40 * DAY, NOW - 1 * DAY] },
      { url: "about:preferences", visits: [NOW - 30 * DAY] },
    ],
    cookies: [
      cookie(".old.com"),
      cookie("api.active.com"), // other subdomain of an active site: kept
      cookie(".tracker.net", { partitionKey: { topLevelSite: "https://active.com" } }), // partitioned under active: kept
      cookie(".tracker.net", { partitionKey: { topLevelSite: "https://old.com" } }), // partitioned under stale: gone
      cookie("orphan.org", { storeId: "firefox-container-1", secure: false, path: "/p" }), // no history at all: gone
    ],
  });
  const p = await Sweep.plan(api, settings, NOW);
  const s = Sweep.summarize(p);
  assert.deepEqual(s.sites.map((x) => x.site), ["old.com", "orphan.org"]);
  assert.equal(s.counts.cookies, 3);
  assert.equal(s.counts.historyUrls, 3); // www.old.com, dev.old.com, about:preferences
  assert.equal(s.recentSiteCount, 1);

  const r = await Sweep.execute(api, p);
  assert.deepEqual(r.failures, {});
  assert.equal(r.counts.cookies, 3);
  assert.deepEqual(api.calls.deleteRange, [{ startTime: 0, endTime: NOW - 7 * DAY }]);

  const hosts = api.calls.browsingData[0].hostnames;
  for (const h of ["old.com", "www.old.com", "dev.old.com", "dev.old.com:8080", "orphan.org"]) {
    assert.ok(hosts.includes(h), `expected ${h} in ${hosts}`);
  }
  assert.ok(!hosts.some((h) => h.includes("active") || h.includes("tracker")), hosts.join());
  assert.deepEqual(api.calls.browsingData.map((c) => Object.keys(c.types)[0]),
    ["localStorage", "indexedDB", "serviceWorkers"]);
  assert.deepEqual(api.calls.cacheCleared, [{}]); // whole cache: per-host clearing doesn't work in Firefox

  const removed = api.calls.cookiesRemoved;
  assert.ok(removed.some((d) => d.url === "http://orphan.org/p" && d.storeId === "firefox-container-1"));
  assert.ok(removed.some((d) => d.partitionKey?.topLevelSite === "https://old.com"));
  assert.ok(!removed.some((d) => d.partitionKey?.topLevelSite === "https://active.com"));
});

test("open tabs and the keep list protect a site", async () => {
  const api = fakeApi({
    history: [
      { url: "https://open.com/", visits: [NOW - 30 * DAY] },
      { url: "https://mail.kept.com/", visits: [NOW - 30 * DAY] },
    ],
    tabs: ["https://www.open.com/inbox", "about:newtab"],
    cookies: [cookie(".open.com"), cookie("login.kept.com")],
  });
  const p = await Sweep.plan(api, { ...settings, keepSites: ["kept.com"] }, NOW);
  assert.equal(p.stale.size, 0);
  // History still expires for them.
  await Sweep.execute(api, p);
  assert.equal(api.calls.deleteRange.length, 1);
  assert.equal(api.calls.cookiesRemoved.length, 0);
  assert.equal(api.calls.browsingData.length, 0);
  assert.equal(api.calls.cacheCleared.length, 0); // nothing expired, so the cache is left alone
});

test("disabled categories are left alone", async () => {
  const api = fakeApi({
    history: [{ url: "https://old.com/", visits: [NOW - 30 * DAY] }],
    cookies: [cookie("old.com")],
    downloads: [{ id: 1, startTime: NOW - 30 * DAY, state: "complete" }],
    closed: [{ lastModified: NOW - 30 * DAY, tab: { windowId: 1, sessionId: "a" } }],
  });
  const off = { ...settings, history: false, cookies: false, siteData: false, downloads: false, closedTabs: false };
  const p = await Sweep.plan(api, off, NOW);
  await Sweep.execute(api, p);
  const c = api.calls;
  assert.equal(c.deleteRange.length + c.cookiesRemoved.length + c.browsingData.length + c.erased.length + c.forgotTabs.length, 0);
});

test("downloads and closed tabs expire by age; in-progress downloads survive", async () => {
  const api = fakeApi({
    downloads: [
      { id: 1, startTime: NOW - 30 * DAY, state: "complete" },
      { id: 2, startTime: NOW - 30 * DAY, state: "in_progress" },
      { id: 3, startTime: NOW - 1 * DAY, state: "complete" },
    ],
    closed: [
      { lastModified: NOW - 30 * DAY, tab: { windowId: 4, sessionId: "old-tab" } },
      { lastModified: NOW - 30 * DAY, window: { sessionId: "old-win" } },
      { lastModified: NOW - 1 * DAY, tab: { windowId: 4, sessionId: "new-tab" } },
    ],
  });
  const p = await Sweep.plan(api, settings, NOW);
  const r = await Sweep.execute(api, p);
  assert.deepEqual(api.calls.erased, [1]);
  assert.deepEqual(api.calls.forgotTabs, [[4, "old-tab"]]);
  assert.deepEqual(api.calls.forgotWindows, ["old-win"]);
  assert.equal(r.counts.closedTabs, 2);
});

test("a failing step is counted without stopping the others or recording hostnames", async () => {
  const api = fakeApi({ history: [{ url: "https://old.com/", visits: [NOW - 30 * DAY] }], cookies: [cookie("old.com")] });
  api.browsingData.remove = async () => { throw new Error("boom for old.com"); };
  api.browsingData.removeCache = async () => { throw new Error("boom"); };
  const p = await Sweep.plan(api, settings, NOW);
  const r = await Sweep.execute(api, p);
  assert.deepEqual(r.failures, { cache: 1, localStorage: 1, indexedDB: 1, serviceWorkers: 1 });
  assert.equal(r.counts.cookies, 1);
  assert.equal(api.calls.deleteRange.length, 1);
  assert.ok(!JSON.stringify(r).includes("old.com"));
});

test("sweep interval scales with the limit", () => {
  const S = globalThis.Settings;
  assert.equal(S.sweepIntervalMinutes(S.normalize({ amount: 1, unit: "minutes" })), 1);
  assert.equal(S.sweepIntervalMinutes(S.normalize({ amount: 20, unit: "minutes" })), 5);
  assert.equal(S.sweepIntervalMinutes(S.normalize({ amount: 7, unit: "days" })), 15);
  assert.equal(S.normalize({ amount: -3, unit: "bogus" }).unit, "days");
  assert.equal(S.normalize({ amount: -3 }).amount, 1);
});
