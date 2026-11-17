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

let running = null;

// Serializes sweeps so an alarm and a manual "sweep now" can't overlap.
function sweep({ force = false } = {}) {
  if (!running) {
    running = (async () => {
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
    })().finally(() => {
      running = null;
    });
  }
  return running;
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
    case "schedule":
      return schedule().then(() => browser.alarms.get(ALARM));
  }
  return undefined;
});
