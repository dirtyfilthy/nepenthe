// Maps hosts and URLs to "sites" (registrable domains, eTLD+1) using the
// bundled Public Suffix List, so www.example.com, api.example.com and
// example.com are all treated as one site, while foo.github.io and
// bar.github.io stay separate.
(function (root) {
  let rules = null;

  function loadRules() {
    if (rules) return rules;
    rules = { exact: new Set(), wildcard: new Set(), exception: new Set() };
    for (const r of root.PSL_RULES.split("\n")) {
      if (r.startsWith("!")) rules.exception.add(r.slice(1));
      else if (r.startsWith("*.")) rules.wildcard.add(r.slice(2));
      else rules.exact.add(r);
    }
    return rules;
  }

  function normalizeHost(host) {
    return String(host || "").trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
  }

  function isIp(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
  }

  // Registrable domain for a hostname; IPs and single-label hosts map to themselves.
  function baseDomain(host) {
    host = normalizeHost(host);
    if (!host || isIp(host) || !host.includes(".")) return host;
    const { exact, wildcard, exception } = loadRules();
    const labels = host.split(".");
    // Walk from the longest candidate suffix to the shortest; first match wins.
    for (let i = 0; i < labels.length; i++) {
      const candidate = labels.slice(i).join(".");
      const parent = labels.slice(i + 1).join(".");
      let suffixStart = -1;
      if (exception.has(candidate)) suffixStart = i + 1;
      else if (exact.has(candidate) || (parent && wildcard.has(parent))) suffixStart = i;
      if (suffixStart !== -1) {
        // Host is itself a public suffix: treat it as its own site.
        if (suffixStart === 0) return host;
        return labels.slice(suffixStart - 1).join(".");
      }
    }
    // Default rule "*": the public suffix is the last label.
    return labels.slice(-2).join(".");
  }

  const WEB_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

  function parseWebUrl(url) {
    try {
      const u = new URL(url);
      return WEB_PROTOCOLS.has(u.protocol) && u.hostname ? u : null;
    } catch {
      return null;
    }
  }

  function siteOfUrl(url) {
    const u = parseWebUrl(url);
    return u ? baseDomain(u.hostname) : null;
  }

  const Domain = { normalizeHost, baseDomain, siteOfUrl, parseWebUrl };
  root.Domain = Domain;
  if (typeof module !== "undefined") module.exports = Domain;
})(globalThis);
