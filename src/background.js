/* global Settings, Sweep */
const ALARM = "nepenthe-sweep";
const STARTUP_ALARM = "nepenthe-startup-sweep";

async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return Settings.normalize(settings);
}

async function schedule() {
  const s = await getSettings();
  if (!s.enabled) {
    await browser.alarms.clear(ALARM);
    return;
  }
  const period = Settings.sweepIntervalMinutes(s);
  const existing = await browser.alarms.get(ALARM);
  // Don't reset a running timer every time this (non-persistent) script wakes up.
  if (!existing || existing.periodInMinutes !== period) {
    browser.alarms.create(ALARM, { delayInMinutes: period, periodInMinutes: period });
  }
}

// Runs deletions one at a time so a sweep and a "bad night" can't overlap.
let queue = Promise.resolve();
function exclusive(task) {
  const p = queue.then(task);
  queue = p.catch(() => {});
  return p;
}

let running = null;

// An alarm and a manual "sweep now" that arrive together share one sweep.
function sweep({ force = false } = {}) {
  if (!running) {
    running = exclusive(async () => {
      const settings = await getSettings();
      if (!settings.enabled && !force) return null;
      const result = { at: Date.now(), ok: true, counts: null, failures: {} };
      try {
        const p = await Sweep.plan(browser, settings);
        Object.assign(result, await Sweep.execute(browser, p));
        result.ok = Object.keys(result.failures).length === 0;
      } catch (e) {
        result.ok = false;
        result.failures = { plan: 1 };
        console.error("nepenthe: sweep failed", e);
      }
      await browser.storage.local.set({ lastSweep: result });
      return result;
    }).finally(() => {
      running = null;
    });
  }
  return running;
}

function validSince(since) {
  if (typeof since !== "number" || !Number.isFinite(since) || since >= Date.now()) {
    throw new Error("Pick a time in the past.");
  }
  return since;
}

async function badNightPlan(since) {
  return Sweep.planBadNight(browser, await getSettings(), validSince(since));
}

// Not recorded in storage: the counts alone would say when you had a bad night.
function badNight(since) {
  return exclusive(async () => Sweep.execute(browser, await badNightPlan(since)));
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM || alarm.name === STARTUP_ALARM) sweep();
});

browser.runtime.onStartup.addListener(async () => {
  await schedule();
  // Give session restore a minute to reopen tabs, so open sites count as recent.
  browser.alarms.create(STARTUP_ALARM, { delayInMinutes: 1 });
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  await schedule();
  if (reason === "install") browser.runtime.openOptionsPage();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) schedule();
});

browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());

browser.runtime.onMessage.addListener((msg) => {
  switch (msg && msg.type) {
    case "preview":
      return getSettings().then((s) => Sweep.plan(browser, s)).then(Sweep.summarize);
    case "sweep":
      return sweep({ force: true });
    case "badNightPreview":
      return badNightPlan(msg.since).then(Sweep.summarize);
    case "badNight":
      return badNight(msg.since);
    case "schedule":
      return schedule().then(() => browser.alarms.get(ALARM));
  }
  return undefined;
});
