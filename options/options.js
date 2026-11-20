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

// The form as it was when last loaded or saved, to tell whether it has edits
// that Save hasn't written yet. Null until the stored settings are filled in.
let savedForm = null;
let savedNoteTimer;

function formState() {
  return JSON.stringify([
    $("amount").value,
    $("unit").value,
    parseKeepSites($("keepSites").value),
    BOOL_FIELDS.map((f) => $(f).checked),
  ]);
}

const hasUnsavedChanges = () => savedForm !== null && formState() !== savedForm;

function showSaveState(note = "") {
  clearTimeout(savedNoteTimer);
  const unsaved = hasUnsavedChanges();
  const el = $("saved");
  el.textContent = unsaved ? "Unsaved changes." : note;
  el.classList.toggle("actions-status-unsaved", unsaved);
}

// Call after the form and storage agree. A note passed with `fade` clears itself.
function markSaved(note = "", fade = false) {
  savedForm = formState();
  showSaveState(note);
  if (fade) savedNoteTimer = setTimeout(showSaveState, 2000);
}

const fmt = (t) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describe(counts) {
  return [
    count(counts.sites, "site"),
    count(counts.cookies, "cookie"),
    count(counts.historyUrls, "history page"),
    count(counts.downloads, "download"),
    count(counts.closedTabs, "closed tab/window", "closed tabs/windows"),
  ].join(", ");
}

// The steps a run can report a problem with, in the page's own words.
const STEP_NAMES = {
  plan: "working out what has expired",
  cache: "browser cache",
  localStorage: "local storage",
  indexedDB: "IndexedDB",
  serviceWorkers: "service workers",
  cookies: "cookies",
  history: "history",
  formData: "search and form history",
  downloads: "download list",
  closedTabs: "recently closed tabs and windows",
};
const describeFailures = (failures) => Object.keys(failures).map((step) => STEP_NAMES[step] || step).join(", ");

async function renderStatus() {
  const [{ settings, lastSweep }, alarm] = await Promise.all([
    browser.storage.local.get(["settings", "lastSweep"]),
    browser.runtime.sendMessage({ type: "schedule" }),
  ]);
  const s = Settings.normalize(settings);
  // One fact per row: [label, value, optional bold lead-in].
  const rows = [
    s.enabled
      ? ["Automatic deletion", ` Things disappear after ${count(s.amount, s.unit.slice(0, -1))}.`, "On."]
      : ["Automatic deletion", " Nothing is deleted automatically.", "Off."],
  ];
  if (alarm) {
    const every = alarm.periodInMinutes === 1 ? "minute" : `${alarm.periodInMinutes} minutes`;
    rows.push(["Next check", `${fmt(alarm.scheduledTime)}, then every ${every}`]);
  }
  if (lastSweep) {
    rows.push(["Last run", fmt(lastSweep.at)]);
    if (lastSweep.counts) rows.push(["Deleted", describe(lastSweep.counts)]);
    if (!lastSweep.ok) rows.push(["Problems with", describeFailures(lastSweep.failures)]);
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

// Preview and "Delete expired now" go by the saved settings, which isn't what
// the form shows while it has edits pending.
const unsavedNote = () => (hasUnsavedChanges() ? "This goes by the saved settings, not your unsaved changes." : "");

async function preview(note = "") {
  const r = await browser.runtime.sendMessage({ type: "preview" });
  $("preview-out").hidden = false;
  $("preview-summary").textContent =
    `Would delete: ${describe(r.counts)}. Everything before ${fmt(r.cutoff)} counts as expired; ` +
    `${r.recentSiteCount} site${r.recentSiteCount === 1 ? " is" : "s are"} still active.` +
    (note && ` ${note}`);
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
      counts.textContent = `${count(x.cookies, "cookie")}, ${count(x.historyUrls, "history page")}`;
      li.append(code, counts);
      return li;
    })
  );
  return r;
}

async function save() {
  const next = readForm();
  const { settings: prev } = await browser.storage.local.get("settings");
  if (next.enabled && !Settings.normalize(prev).enabled) {
    // Turning it on: show what the first run will delete before committing.
    await browser.storage.local.set({ settings: { ...next, enabled: false } });
    const r = await preview();
    if (!confirm(`Turn on Nepenthe? The first run will delete ${describe(r.counts)}. This can't be undone.`)) {
      $("enabled").checked = false;
      markSaved("Saved, but left off.");
      return renderStatus();
    }
  }
  await browser.storage.local.set({ settings: next });
  fillForm(next);
  markSaved("Saved.", true);
  return renderStatus();
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  save().catch((err) => alert(`Couldn't save: ${err.message}`));
});

$("form").addEventListener("input", () => showSaveState());

// Closing or reloading the tab with edits pending would drop them silently,
// leaving the old rules in force. Firefox asks before leaving instead.
window.addEventListener("beforeunload", (e) => {
  if (hasUnsavedChanges()) e.preventDefault();
});

$("preview").addEventListener("click", () => preview(unsavedNote()).catch((e) => alert(e.message)));

$("sweep").addEventListener("click", async () => {
  const btn = $("sweep");
  btn.disabled = true;
  try {
    const note = unsavedNote();
    const r = await preview(note);
    if (!confirm(`Delete ${describe(r.counts)} now? This can't be undone.${note && `\n\n${note}`}`)) return;
    await browser.runtime.sendMessage({ type: "sweep" });
    $("preview-out").hidden = true;
  } catch (e) {
    alert(`Couldn't do it: ${e.message}`);
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
    status.textContent = failed.length ? `Done, but with problems: ${describeFailures(result.failures)}.` : "Forgotten.";
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

browser.storage.local.get("settings").then(({ settings }) => {
  fillForm(Settings.normalize(settings));
  markSaved();
});
renderStatus();
checkPermission();

// An automatic run while the page is open: show its result without a reload.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastSweep) renderStatus();
});
