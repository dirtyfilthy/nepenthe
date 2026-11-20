const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const tool = import("../tools/wiki.mjs");
const REPO = "https://github.com/example/nepenthe";

test("every wiki page can be built from the README as it is now", async () => {
  const { buildWiki } = await tool;
  // Throws if a section a page is built from was renamed or removed.
  const files = buildWiki(readFileSync(join(__dirname, "..", "README.md"), "utf8"), REPO);
  assert.deepEqual(Object.keys(files).sort(), [
    "Bad-night.md",
    "Development.md",
    "Home.md",
    "Install-from-source.md",
    "Releasing.md",
    "Turn-off-search-and-form-history.md",
    "What-gets-deleted.md",
    "What-it-cannot-erase.md",
    "_Sidebar.md",
  ]);
  for (const [name, text] of Object.entries(files)) {
    assert.ok(text.trim().length > 100, `${name} is nearly empty`);
    // No link still points into the README or at a file beside it.
    for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) assert.match(href, /^https:/, `${name} links to ${href}`);
  }
});

test("links are pointed at wiki pages and the repository", async () => {
  const { buildWiki } = await tool;
  const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
  const files = buildWiki(readme, REPO);
  assert.match(files["What-it-cannot-erase.md"], /which the \[\[Bad night\]\] button uses/);
  assert.match(files["What-it-cannot-erase.md"], /\(see \[\[Turn off search and form history\]\]\)/);
  assert.match(files["Releasing.md"], /\[CHANGELOG\.md\]\(https:\/\/github\.com\/example\/nepenthe\/blob\/main\/CHANGELOG\.md\)/);
  assert.match(files["Home.md"], /- \[\[Bad night\]\]: /);
});

test("a README section that goes missing is named", async () => {
  const { buildWiki } = await tool;
  assert.throws(() => buildWiki("# Nepenthe\n\nIntro.\n\nRules.\n", REPO), /no "## Bad night" section/);
});

test("a # line inside a code block isn't a heading", async () => {
  const { parseReadme } = await tool;
  const readme = parseReadme("# T\n\nIntro.\n\n## Install\n\n```bash\n# a comment\n## not a heading\n```\n\nAfter.\n");
  assert.deepEqual(readme.sections.map((s) => s.name), ["Install"]);
  assert.match(readme.sections[0].body, /## not a heading[\s\S]*After\./);
});
