const test = require("node:test");
const assert = require("node:assert/strict");

const tool = import("../tools/github-release.mjs");
const URL = "https://addons.mozilla.org/en-US/firefox/addon/nepenthe/";

test("storeLine says whether a version is on the store", async () => {
  const { storeLine } = await tool;
  const store = { url: URL, current: "0.1.6", versions: ["0.1.6", "0.1.5"] };
  assert.match(storeLine("0.1.6", store), /yes\. \[Get Nepenthe for Firefox\]/);
  assert.match(storeLine("0.1.5", store), /yes, as an older version\. The store now installs 0\.1\.6/);
  // Older than the store's version and not there: it never will be.
  assert.match(storeLine("0.1.2", store), /no\. The store has 0\.1\.6/);
  // Newer than the store's version: still in review.
  assert.match(storeLine("0.1.10", store), /not yet/);
  // The listing itself isn't public yet.
  assert.match(storeLine("0.1.5", null), /not yet/);
});

test("withStoreLine adds the line once and replaces it after that", async () => {
  const { withStoreLine, hasStoreLine } = await tool;
  const first = withStoreLine("- A change.\n", "not yet");
  assert.equal(first, "- A change.\n\n<!-- store-status -->\nnot yet\n<!-- /store-status -->\n");
  assert.ok(hasStoreLine(first));
  assert.ok(!hasStoreLine("- A change."));
  const second = withStoreLine(first, "yes");
  assert.equal(second, "- A change.\n\n<!-- store-status -->\nyes\n<!-- /store-status -->\n");
  assert.equal(withStoreLine(second, "yes"), second);
});

test("changelogSection finds a version's notes", async () => {
  const { changelogSection } = await import("../tools/changelog.mjs");
  const text = "# Changelog\n\n## Unreleased\n\n- Next.\n\n## 0.1.5 (2026-11-19)\n\n- Five.\n\n## 0.1.4 (2026-11-17)\n\n- Four.\n";
  assert.equal(changelogSection(text, "0.1.5"), "- Five.");
  assert.equal(changelogSection(text, "0.1.4"), "- Four.");
  assert.equal(changelogSection(text, "0.1.9"), null);
});
