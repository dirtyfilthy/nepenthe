const test = require("node:test");
const assert = require("node:assert/strict");

const tool = import("../tools/listing.mjs");

// The add-on as the store's API returns it: the description comes back as HTML.
const live = {
  slug: "abc",
  name: { "en-US": "Nepenthe" },
  summary: { "en-US": "Old summary." },
  homepage: { url: { "en-US": "https://example.com" }, outgoing: { "en-US": "https://outgoing.example/x" } },
  description: {
    "en-US":
      'Intro line:\n<ul><li><strong>History:</strong> every visit you haven\'t kept.</li><li><strong>Cookies:</strong> stale ones &amp; more.</li></ul>\nSecond paragraph.\n\nSource: <a href="https://outgoing.example/x" rel="nofollow">https://example.com</a>',
  },
  tags: ["security", "privacy"],
};
const file = () => ({
  categories: { firefox: ["privacy-security"] },
  tags: ["privacy", "security"],
  summary: { "en-US": "Old summary." },
  homepage: { "en-US": "https://example.com" },
  description: {
    "en-US": "Intro line:\n\n- **History:** every visit you haven't kept.\n- **Cookies:** stale ones & more.\n\nSecond paragraph.\n\nSource: https://example.com",
  },
});

test("a listing that matches the file has no changes, whatever the store did to the Markdown", async () => {
  const { listingChanges } = await tool;
  assert.deepEqual(listingChanges(file(), live), []);
});

test("only the fields that differ are shown and sent", async () => {
  const { listingChanges, patchBody } = await tool;
  const wanted = file();
  wanted.summary["en-US"] = "New summary.";
  wanted.description["en-US"] = wanted.description["en-US"].replace("Second paragraph.", "Second paragraph.\n\n**New:** a third.");
  const changes = listingChanges(wanted, live);
  assert.deepEqual(
    changes.map(({ field, removed, added }) => ({ field, removed, added })),
    [
      { field: "summary (en-US)", removed: ["Old summary."], added: ["New summary."] },
      { field: "description (en-US)", removed: [], added: ["New: a third."] },
    ],
  );
  // The description is sent as the Markdown in the file, not the compared text.
  assert.deepEqual(patchBody(changes), { summary: { "en-US": "New summary." }, description: { "en-US": wanted.description["en-US"] } });
});

test("tags, and a slug when the file has one, are compared too", async () => {
  const { listingChanges, patchBody } = await tool;
  const wanted = { ...file(), tags: ["privacy", "container"], slug: "nepenthe" };
  assert.deepEqual(patchBody(listingChanges(wanted, live)), { slug: "nepenthe", tags: ["privacy", "container"] });
});
