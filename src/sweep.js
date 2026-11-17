// Core sweep logic. `api` is the WebExtension `browser` object (or a fake in tests).
//
// Rules:
//  - History: every visit older than the limit is deleted, even for sites you
//    still use (like disappearing messages: each visit expires on its own).
//  - Downloads list and recently-closed tabs: entries older than the limit.
//  - Cookies + site data (cache, localStorage, IndexedDB, service workers):
//    deleted for every site with no visit inside the limit, no open tab, and
//    not on the keep list. Partitioned (third-party) cookies follow the
//    top-level site they were set under.
(function (root) {
  const D = root.Domain;
  const S = root.Settings;
  const MAX_RESULTS = 1000000;

  function cookieHost(c) {
    return D.normalizeHost(c.domain);
  }

  // The site a cookie is evidence of: its top-level site if partitioned, else its own domain.
  function cookieSite(c) {
    const top = c.partitionKey && c.partitionKey.topLevelSite;
    if (top) return D.siteOfUrl(top);
    return D.baseDomain(cookieHost(c));
  }

  async function plan(api, rawSettings, now = Date.now()) {
    const settings = S.normalize(rawSettings);
    const cutoff = now - S.windowMs(settings);

    // Sites that are still "alive".
    const recent = new Set();
    for (const s of settings.keepSites) {
      const site = D.baseDomain(s);
      if (site) recent.add(site);
    }
    const recentHistory = await api.history.search({ text: "", startTime: cutoff, maxResults: MAX_RESULTS });
    for (const item of recentHistory) {
      if ((item.lastVisitTime || 0) >= cutoff) {
        const site = D.siteOfUrl(item.url);
        if (site) recent.add(site);
      }
    }
    for (const tab of await api.tabs.query({})) {
      const site = D.siteOfUrl(tab.url);
      if (site) recent.add(site);
    }

    // site -> { hosts: Set, cookies: [], historyUrls: n }
    const stale = new Map();
    const entry = (site) => {
      let e = stale.get(site);
      if (!e) {
        e = { hosts: new Set([site, "www." + site]), cookies: [], historyUrls: 0 };
        stale.set(site, e);
      }
      return e;
    };

    const oldHistory = await api.history.search({ text: "", startTime: 0, endTime: cutoff, maxResults: MAX_RESULTS });
    let expiredHistoryUrls = 0;
    for (const item of oldHistory) {
      if ((item.lastVisitTime || 0) < cutoff) expiredHistoryUrls++;
      const u = D.parseWebUrl(item.url);
      if (!u) continue;
      const site = D.baseDomain(u.hostname);
      if (recent.has(site)) continue;
      const e = entry(site);
      e.hosts.add(u.hostname);
      e.hosts.add(u.host); // includes a non-default port; storage is keyed by host:port
      e.historyUrls++;
    }

    const staleCookies = [];
    if (settings.cookies || settings.siteData) {
      for (const store of await api.cookies.getAllCookieStores()) {
        const cookies = await api.cookies.getAll({ storeId: store.id, firstPartyDomain: null, partitionKey: {} });
        for (const c of cookies) {
          const site = cookieSite(c);
          if (!site || recent.has(site)) continue;
          const e = entry(site);
          e.cookies.push(c);
          staleCookies.push(c);
          const top = c.partitionKey && c.partitionKey.topLevelSite;
          e.hosts.add(top ? D.parseWebUrl(top)?.hostname || site : cookieHost(c));
        }
      }
    }

    let downloads = [];
    if (settings.downloads) {
      downloads = (await api.downloads.search({ startedBefore: cutoff })).filter((d) => d.state !== "in_progress");
    }

    let closed = [];
    if (settings.closedTabs) {
      closed = (await api.sessions.getRecentlyClosed()).filter((s) => (s.lastModified || 0) < cutoff);
    }

    return { settings, cutoff, recentSiteCount: recent.size, stale, staleCookies, expiredHistoryUrls, downloads, closed };
  }

  // A JSON-safe view of a plan for the options page (kept in memory only).
  function summarize(p) {
    const sites = [...p.stale.entries()]
      .map(([site, e]) => ({ site, cookies: e.cookies.length, historyUrls: e.historyUrls }))
      .sort((a, b) => a.site.localeCompare(b.site));
    return {
      cutoff: p.cutoff,
      recentSiteCount: p.recentSiteCount,
      sites,
      counts: {
        sites: sites.length,
        cookies: p.settings.cookies ? p.staleCookies.length : 0,
        historyUrls: p.settings.history ? p.expiredHistoryUrls : 0,
        downloads: p.downloads.length,
        closedTabs: p.closed.length,
      },
    };
  }

  function cookieUrl(c) {
    const host = cookieHost(c);
    const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${c.secure ? "https" : "http"}://${h}${c.path || "/"}`;
  }

  async function execute(api, p) {
    const { settings } = p;
    const counts = { sites: p.stale.size, cookies: 0, historyUrls: 0, downloads: 0, closedTabs: 0 };
    // Only step names and failure counts are recorded: never hostnames or URLs.
    const failures = {};
    const fail = (step) => (failures[step] = (failures[step] || 0) + 1);

    const hostnames = [...new Set([...p.stale.values()].flatMap((e) => [...e.hosts]))];

    // Site data first, while we still know which hosts to target.
    if (settings.siteData && hostnames.length) {
      // Firefox's per-host cache clearing only matches unpartitioned entries, but
      // with network partitioning (the default) every entry is partitioned, so it
      // silently removes nothing. The whole HTTP cache is the only reliable target.
      try {
        await api.browsingData.removeCache({});
      } catch {
        fail("cache");
      }
      // One call per type so a failure in one doesn't skip the rest.
      for (const type of ["localStorage", "indexedDB", "serviceWorkers"]) {
        try {
          await api.browsingData.remove({ hostnames }, { [type]: true });
        } catch {
          fail(type);
        }
      }
    }

    if (settings.cookies) {
      for (const c of p.staleCookies) {
        const details = { url: cookieUrl(c), name: c.name, storeId: c.storeId };
        if (c.firstPartyDomain !== undefined) details.firstPartyDomain = c.firstPartyDomain;
        if (c.partitionKey) details.partitionKey = c.partitionKey;
        try {
          if (await api.cookies.remove(details)) counts.cookies++;
          else fail("cookies");
        } catch {
          fail("cookies");
        }
      }
    }

    if (settings.history) {
      try {
        await api.history.deleteRange({ startTime: 0, endTime: p.cutoff });
        counts.historyUrls = p.expiredHistoryUrls;
      } catch {
        fail("history");
      }
    }

    for (const d of p.downloads) {
      try {
        await api.downloads.erase({ id: d.id });
        counts.downloads++;
      } catch {
        fail("downloads");
      }
    }

    for (const s of p.closed) {
      try {
        if (s.tab) await api.sessions.forgetClosedTab(s.tab.windowId, s.tab.sessionId);
        else if (s.window) await api.sessions.forgetClosedWindow(s.window.sessionId);
        counts.closedTabs++;
      } catch {
        fail("closedTabs");
      }
    }

    return { counts, failures };
  }

  const Sweep = { plan, summarize, execute, cookieSite, cookieUrl };
  root.Sweep = Sweep;
  if (typeof module !== "undefined") module.exports = Sweep;
})(globalThis);
