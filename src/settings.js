(function (root) {
  const DEFAULTS = Object.freeze({
    // Off until the user saves settings once, so installing never wipes data by surprise.
    enabled: false,
    amount: 7,
    unit: "days",
    history: true, // every visit older than the limit
    cookies: true, // cookies of sites not visited within the limit
    siteData: true, // cache, localStorage, IndexedDB, service workers of those sites
    downloads: true, // download list entries older than the limit (files stay on disk)
    closedTabs: true, // "recently closed" tabs/windows older than the limit
    keepSites: [], // sites whose cookies/site data are never expired
  });

  const UNIT_MS = { minutes: 60e3, hours: 3600e3, days: 86400e3, weeks: 7 * 86400e3 };

  function normalize(s) {
    const out = { ...DEFAULTS, ...(s || {}) };
    if (!UNIT_MS[out.unit]) out.unit = DEFAULTS.unit;
    out.amount = Math.max(1, Math.floor(Number(out.amount) || DEFAULTS.amount));
    out.keepSites = Array.isArray(out.keepSites) ? out.keepSites : [];
    return out;
  }

  function windowMs(s) {
    return s.amount * UNIT_MS[s.unit];
  }

  // Sweep often enough that nothing outlives the limit by more than ~25%,
  // but no more than every minute and no less than every 15 minutes.
  function sweepIntervalMinutes(s) {
    return Math.min(15, Math.max(1, Math.floor(windowMs(s) / 60e3 / 4)));
  }

  const Settings = { DEFAULTS, UNIT_MS, normalize, windowMs, sweepIntervalMinutes };
  root.Settings = Settings;
  if (typeof module !== "undefined") module.exports = Settings;
})(globalThis);
