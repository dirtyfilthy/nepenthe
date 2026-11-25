// Keeps the store listing on addons.mozilla.org in step with amo-metadata.json.
// The listing's text is separate from the extension file, so changing it needs
// no new version and no review.
//
//   node tools/listing.mjs          show what differs between the file and the store
//   node tools/listing.mjs --push   send the fields that differ to the store
//
// Covers summary, description, homepage and tags, plus name and slug if the file
// has them. Categories and the license are left alone: they're only sent with a release.
// Needs the addons.mozilla.org API keys in the environment or the macOS keychain (see README).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAmoKeys, MISSING_KEYS_HELP } from "./amo-keys.mjs";
import { getAddon, patchAddon } from "./amo-api.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " " };

// The store hands the description back as HTML, not as the Markdown that was sent,
// so the two are compared as plain lines of text. A change that is only formatting
// (bold, a list turned into paragraphs) isn't noticed.
export function htmlLines(html) {
  return String(html ?? "")
    .replace(/<\/?(ul|ol|li|p|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function markdownLines(markdown) {
  return String(markdown ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Compares amo-metadata.json with the add-on as the store's API returns it.
// Returns one entry per field that differs: { field, removed, added, send },
// where removed/added are lines of text to show and send is the value to PATCH.
export function listingChanges(file, live) {
  const changes = [];
  const text = (field, liveValue) => {
    for (const [locale, wanted] of Object.entries(file[field] ?? {})) {
      const current = liveValue?.[locale] ?? "";
      if (wanted !== current) changes.push({ field: `${field} (${locale})`, removed: [current], added: [wanted], send: [field, locale, wanted] });
    }
  };
  text("name", live.name);
  text("summary", live.summary);
  text("homepage", live.homepage?.url);
  for (const [locale, wanted] of Object.entries(file.description ?? {})) {
    const current = htmlLines(live.description?.[locale]);
    const lines = markdownLines(wanted);
    const removed = current.filter((line) => !lines.includes(line));
    const added = lines.filter((line) => !current.includes(line));
    // Same lines in another order still counts as a change.
    if (!same(current, lines)) changes.push({ field: `description (${locale})`, removed, added, send: ["description", locale, wanted] });
  }
  if (file.slug !== undefined && file.slug !== live.slug) changes.push({ field: "slug", removed: [live.slug], added: [file.slug], send: ["slug", null, file.slug] });
  if (file.tags && !same([...file.tags].sort(), [...(live.tags ?? [])].sort())) {
    changes.push({ field: "tags", removed: [(live.tags ?? []).join(", ")], added: [file.tags.join(", ")], send: ["tags", null, file.tags] });
  }
  return changes;
}

// The body of the PATCH: only the fields that differ.
export function patchBody(changes) {
  const body = {};
  for (const { send: [field, locale, value] } of changes) {
    if (locale) body[field] = { ...body[field], [locale]: value };
    else body[field] = value;
  }
  return body;
}

function die(message) {
  console.error(`listing: ${message}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.find((a) => a !== "--push");
  if (unknown) die(`don't know "${unknown}". The only option is --push.`);
  if (!loadAmoKeys()) die(MISSING_KEYS_HELP);

  try {
    const file = JSON.parse(readFileSync(join(ROOT, "amo-metadata.json"), "utf8"));
    const live = await getAddon();
    const changes = listingChanges(file, live);
    if (!changes.length) {
      console.log(`The listing already matches amo-metadata.json.  ${live.url}`);
    } else {
      for (const { field, removed, added } of changes) {
        console.log(`${field}`);
        for (const line of removed) console.log(`  - ${line}`);
        for (const line of added) console.log(`  + ${line}`);
        console.log("");
      }
      if (!args.includes("--push")) {
        console.log("Lines with - are on the store now; lines with + are in amo-metadata.json.");
        console.log("Nothing was changed. Run `npm run listing -- --push` to update the store.");
      } else {
        await patchAddon(patchBody(changes));
        console.log(`Updated the listing.  ${live.url}`);
      }
    }
  } catch (e) {
    die(e.message);
  }
}
