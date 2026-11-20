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

// Like Firefox, getAllCookieStores only lists the stores in `openStores` (those with a
// tab open). `containers` is what contextualIdentities.query returns, or null when
// containers are switched off, which makes it throw.
function fakeApi({ history = [], tabs = [], cookies = [], downloads = [], closed = [],
  openStores = ["firefox-default"], containers = ["firefox-container-1"] } = {}) {
  const calls = { browsingData: [], cacheCleared: [], formData: [], cookiesRemoved: [], deleteRange: [], erased: [], forgotTabs: [], forgotWindows: [] };
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
      async getAllCookieStores() { return openStores.map((id) => ({ id })); },
      async getAll({ storeId, firstPartyDomain, partitionKey }) {
        assert.equal(firstPartyDomain, null);
        assert.deepEqual(partitionKey, {});
        return cookies.filter((c) => c.storeId === storeId);
      },
      async remove(d) { calls.cookiesRemoved.push(d); return d; },
    },
    contextualIdentities: {
      async query() {
        if (!containers) throw new Error("Contextual identities are currently disabled");
        return containers.map((cookieStoreId) => ({ cookieStoreId }));
      },
    },
    browsingData: {
      async remove(opts, types) { calls.browsingData.push({ hostnames: opts.hostnames, types }); },
      async removeCache(opts) { calls.cacheCleared.push(opts); },
      async removeFormData(opts) { calls.formData.push(opts); },
    },
    downloads: {
      async search({ startedBefore = Infinity, startedAfter = -Infinity }) {
        return downloads.filter((d) => d.startTime < startedBefore && d.startTime > startedAfter);
      },
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
  assert.deepEqual(api.calls.formData, []); // the regular sweep can't expire form history by age

  const removed = api.calls.cookiesRemoved;
  assert.ok(removed.some((d) => d.url === "http://orphan.org/p" && d.storeId === "firefox-container-1"));
  assert.ok(removed.some((d) => d.partitionKey?.topLevelSite === "https://old.com"));
  assert.ok(!removed.some((d) => d.partitionKey?.topLevelSite === "https://active.com"));
});

test("cookies are found in every store, whichever stores have a tab open", async () => {
  const cookies = [
    cookie("a.com"),
    cookie("b.com", { storeId: "firefox-container-1" }),
    cookie("c.com", { storeId: "firefox-container-2" }),
  ];
  const stores = async (opts) => {
    const p = await Sweep.plan(fakeApi({ cookies, ...opts }), settings, NOW);
    return p.staleCookies.map((c) => c.storeId).sort();
  };
  const all = ["firefox-container-1", "firefox-container-2", "firefox-default"];
  const containers = ["firefox-container-1", "firefox-container-2"];
  // No container has a tab open.
  assert.deepEqual(await stores({ containers }), all);
  // Every tab is in a container, so Firefox doesn't list the default store.
  assert.deepEqual(await stores({ containers, openStores: ["firefox-container-2"] }), all);
  // Containers switched off: the default store and the stores with a tab open.
  assert.deepEqual(await stores({ containers: null, openStores: ["firefox-container-2"] }),
    ["firefox-container-2", "firefox-default"]);

  // Bad night reads the same stores.
  const api = fakeApi({
    containers,
    history: [{ url: "https://b.com/", visits: [NOW - 1000] }],
    cookies,
  });
  const night = await Sweep.planBadNight(api, settings, NOW - 2000, NOW);
  assert.deepEqual(night.staleCookies.map((c) => c.storeId), ["firefox-container-1"]);
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

test("bad night forgets everything since a time, and new sites lose their cookies", async () => {
  const HOUR = 3600e3;
  const since = NOW - 12 * HOUR;
  const api = fakeApi({
    history: [
      { url: "https://www.new.com/a", visits: [NOW - 2 * HOUR] },
      { url: "http://x.new.com:8080/b", visits: [NOW - 1 * HOUR] },
      { url: "https://regular.com/", visits: [NOW - 3 * DAY, NOW - 1 * HOUR] }, // visited before tonight
      { url: "https://other.regular.com/tonight", visits: [NOW - 1 * HOUR] }, // new page, old site
      { url: "https://kept.com/", visits: [NOW - 1 * HOUR] },
      { url: "https://lastweek.com/", visits: [NOW - 3 * DAY] },
      { url: "about:config", visits: [NOW - 1 * HOUR] },
    ],
    tabs: ["https://new.com/still-open", "https://regular.com/"],
    cookies: [
      cookie(".new.com"),
      cookie(".tracker.net", { partitionKey: { topLevelSite: "https://new.com" } }),
      cookie(".tracker.net", { partitionKey: { topLevelSite: "https://regular.com" } }),
      cookie("regular.com"),
      cookie("kept.com"),
      cookie("lastweek.com"),
      cookie("orphan.org"), // no history: left to the regular sweep
    ],
    downloads: [
      { id: 1, startTime: NOW - 3 * DAY, state: "complete" },
      { id: 2, startTime: NOW - 1 * HOUR, state: "complete" },
      { id: 3, startTime: NOW - 1 * HOUR, state: "in_progress" },
    ],
    closed: [
      { lastModified: NOW - 3 * DAY, tab: { windowId: 1, sessionId: "old" } },
      { lastModified: NOW - 1 * HOUR, tab: { windowId: 1, sessionId: "tonight" } },
    ],
  });
  // The automatic settings don't matter: bad night always deletes every category.
  const off = { ...settings, history: false, cookies: false, siteData: false, downloads: false, closedTabs: false, keepSites: ["kept.com"] };
  const p = await Sweep.planBadNight(api, off, since, NOW);
  const s = Sweep.summarize(p);
  assert.deepEqual(s.sites, [{ site: "new.com", cookies: 2, historyUrls: 2 }]);
  assert.deepEqual(s.openSites, ["new.com"]);
  assert.equal(s.counts.historyUrls, 6); // every page visited since, including about:config and regular.com's
  assert.equal(s.since, since);

  const r = await Sweep.execute(api, p);
  assert.deepEqual(r.failures, {});
  assert.deepEqual(api.calls.deleteRange, [{ startTime: since, endTime: NOW }]);
  assert.deepEqual(api.calls.formData, [{ since }]);
  assert.deepEqual(api.calls.cacheCleared, [{}]);
  const hosts = api.calls.browsingData[0].hostnames;
  for (const h of ["new.com", "www.new.com", "x.new.com", "x.new.com:8080"]) assert.ok(hosts.includes(h), h);
  assert.ok(!hosts.some((h) => !h.includes("new.com")), hosts.join());
  assert.deepEqual(api.calls.cookiesRemoved.map((d) => d.partitionKey?.topLevelSite || d.url),
    ["https://new.com/", "https://new.com"]);
  assert.deepEqual(api.calls.erased, [2]);
  assert.deepEqual(api.calls.forgotTabs, [[1, "tonight"]]);
});

test("bad night with only familiar sites still clears tonight's history, form data and cache", async () => {
  const since = NOW - 12 * 3600e3;
  const api = fakeApi({
    history: [{ url: "https://regular.com/", visits: [NOW - 3 * DAY, NOW - 3600e3] }],
    cookies: [cookie("regular.com")],
  });
  const p = await Sweep.planBadNight(api, settings, since, NOW);
  await Sweep.execute(api, p);
  assert.equal(p.stale.size, 0);
  assert.equal(api.calls.cookiesRemoved.length, 0);
  assert.equal(api.calls.browsingData.length, 0);
  assert.deepEqual(api.calls.cacheCleared, [{}]);
  assert.deepEqual(api.calls.formData, [{ since }]);
  assert.deepEqual(api.calls.deleteRange, [{ startTime: since, endTime: NOW }]);
});

test("sweep interval scales with the limit", () => {
  const S = globalThis.Settings;
  assert.equal(S.sweepIntervalMinutes(S.normalize({ amount: 1, unit: "minutes" })), 1);
  assert.equal(S.sweepIntervalMinutes(S.normalize({ amount: 20, unit: "minutes" })), 5);
  assert.equal(S.sweepIntervalMinutes(S.normalize({ amount: 7, unit: "days" })), 15);
  assert.equal(S.normalize({ amount: -3, unit: "bogus" }).unit, "days");
  assert.equal(S.normalize({ amount: -3 }).amount, 1);
});
