/* global Settings, Domain */
const $ = (id) => document.getElementById(id);
const BOOL_FIELDS = ["enabled", "history", "cookies", "siteData", "downloads", "closedTabs"];
const ALL_URLS = { origins: ["<all_urls>"] };

function parseKeepSites(text) {
  const sites = new Set();
  for (let line of text.split(/[\n,]/)) {
    line = line.trim();
    if (!line) continue;
    const site = line.includes("://") ? Domain.siteOfUrl(line) : Domain.baseDomain(line.split("/")[0]);
    if (site) sites.add(site);
  }
  return [...sites].sort();
}

function readForm() {
  const s = {
    amount: Number($("amount").value),
    unit: $("unit").value,
    keepSites: parseKeepSites($("keepSites").value),
  };
  for (const f of BOOL_FIELDS) s[f] = $(f).checked;
  return Settings.normalize(s);
}

function fillForm(s) {
  $("amount").value = s.amount;
  $("unit").value = s.unit;
  $("keepSites").value = s.keepSites.join("\n");
  for (const f of BOOL_FIELDS) $(f).checked = s[f];
}

const fmt = (t) => new Date(t).toLocaleString();

function describe(counts) {
  const parts = [
    [counts.sites, "site", "sites"],
    [counts.cookies, "cookie", "cookies"],
    [counts.historyUrls, "history page", "history pages"],
    [counts.downloads, "download", "downloads"],
    [counts.closedTabs, "closed tab/window", "closed tabs/windows"],
  ].map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return parts.join(", ");
}

async function renderStatus() {
  const [{ settings, lastSweep }, alarm] = await Promise.all([
    browser.storage.local.get(["settings", "lastSweep"]),
    browser.runtime.sendMessage({ type: "schedule" }),
  ]);
  const s = Settings.normalize(settings);
  // One fact per row: [label, value, optional bold lead-in].
  const rows = [
    s.enabled
      ? ["Automatic deletion", ` Things disappear after ${s.amount} ${s.unit}.`, "On."]
      : ["Automatic deletion", " Nothing is deleted automatically.", "Off."],
  ];
  if (alarm) rows.push(["Next check", `${fmt(alarm.scheduledTime)}, then every ${alarm.periodInMinutes} min`]);
  if (lastSweep) {
    rows.push(["Last run", fmt(lastSweep.at)]);
    if (lastSweep.counts) rows.push(["Deleted", describe(lastSweep.counts)]);
    if (!lastSweep.ok) rows.push(["Problems with", Object.keys(lastSweep.failures).join(", ")]);
  }
  $("status").replaceChildren(
    ...rows.flatMap(([label, value, state]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      if (state) {
        const strong = document.createElement("span");
        strong.className = "status-state";
        strong.textContent = state;
        dd.append(strong);
      }
      dd.append(value);
      return [dt, dd];
    })
  );
}

async function checkPermission() {
  $("perm-warning").hidden = await browser.permissions.contains(ALL_URLS);
}

async function preview() {
  const r = await browser.runtime.sendMessage({ type: "preview" });
  $("preview-out").hidden = false;
  $("preview-summary").textContent =
    `Would delete: ${describe(r.counts)}. Everything before ${fmt(r.cutoff)} counts as expired; ` +
    `${r.recentSiteCount} site${r.recentSiteCount === 1 ? " is" : "s are"} still active.`;
  const warn = $("preview-warn");
  warn.hidden = r.recentSiteCount > 0;
  warn.textContent =
    "No site counts as active. If Firefox is set to never remember history, Nepenthe will delete the cookies of every site that isn't open in a tab.";
  const list = $("preview-list");
  list.replaceChildren(
    ...r.sites.map((x) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = x.site;
      const counts = document.createElement("span");
      counts.textContent = `${x.cookies} cookies, ${x.historyUrls} history pages`;
      li.append(code, counts);
      return li;
    })
  );
  return r;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const next = readForm();
  const { settings: prev } = await browser.storage.local.get("settings");
  if (next.enabled && !Settings.normalize(prev).enabled) {
    // Turning it on: show what the first run will delete before committing.
    await browser.storage.local.set({ settings: { ...next, enabled: false } });
    const r = await preview();
    if (!confirm(`Turn on Nepenthe? The first run will delete ${describe(r.counts)}. This can't be undone.`)) {
      $("enabled").checked = false;
      $("saved").textContent = "Saved, but left off.";
      return renderStatus();
    }
  }
  await browser.storage.local.set({ settings: next });
  fillForm(next);
  $("saved").textContent = "Saved.";
  setTimeout(() => ($("saved").textContent = ""), 2000);
  renderStatus();
});

$("preview").addEventListener("click", () => preview().catch((e) => alert(e.message)));

$("sweep").addEventListener("click", async () => {
  const btn = $("sweep");
  const r = await preview();
  if (!confirm(`Delete ${describe(r.counts)} now? This can't be undone.`)) return;
  btn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type: "sweep" });
    $("preview-out").hidden = true;
  } finally {
    btn.disabled = false;
    renderStatus();
  }
});

$("clearForms").addEventListener("click", async () => {
  if (!confirm("Delete everything Firefox has saved from search boxes and web forms? This can't be undone.")) return;
  const btn = $("clearForms");
  const status = $("clearFormsStatus");
  btn.disabled = true;
  try {
    // No "since": removes all form history. Firefox can't remove entries by age.
    await browser.browsingData.removeFormData({});
    status.textContent = "Cleared.";
  } catch (e) {
    status.textContent = `Couldn't clear it: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

function badNightHours() {
  return Math.max(1, Math.floor(Number($("badNightHours").value) || 12));
}

$("badNightHours").addEventListener("input", () => {
  const h = badNightHours();
  $("badNight").textContent = `Forget the last ${h} ${h === 1 ? "hour" : "hours"}`;
});

$("badNight").addEventListener("click", async () => {
  const btn = $("badNight");
  const status = $("badNightStatus");
  const since = Date.now() - badNightHours() * 3600e3;
  btn.disabled = true;
  status.textContent = "";
  try {
    const r = await browser.runtime.sendMessage({ type: "badNightPreview", since });
    let msg = `Forget everything since ${fmt(since)}? This deletes ${describe(r.counts)}, plus search and form history from that time.`;
    if (r.sites.length) msg += `\n\nFirst visited in that time, so their cookies and site data go too: ${r.sites.map((x) => x.site).join(", ")}.`;
    if (r.openSites.length) msg += `\n\nStill open in a tab: ${r.openSites.join(", ")}. Close those tabs too, or they'll put history and cookies straight back.`;
    msg += "\n\nThis can't be undone.";
    if (!confirm(msg)) return;
    const result = await browser.runtime.sendMessage({ type: "badNight", since });
    const failed = Object.keys(result.failures);
    status.textContent = failed.length ? `Done, but with problems: ${failed.join(", ")}.` : "Forgotten.";
  } catch (e) {
    status.textContent = `Couldn't do it: ${e.message}`;
  } finally {
    btn.disabled = false;
    renderStatus();
  }
});

$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ALL_URLS);
  checkPermission();
});

browser.storage.local.get("settings").then(({ settings }) => fillForm(Settings.normalize(settings)));
renderStatus();
checkPermission();
