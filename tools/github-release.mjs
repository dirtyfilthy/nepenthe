// Publishes GitHub releases and keeps a line on each saying whether that
// version is on addons.mozilla.org. Run by .github/workflows/release.yml.
//
//   node tools/github-release.mjs v0.1.6            publish the release for a tag
//   node tools/github-release.mjs --refresh         recheck the store line on existing releases
//   node tools/github-release.mjs v0.1.6 --dry-run  only show what would be written
//
// A new release gets its notes from the version's section of CHANGELOG.md. A
// release that already exists keeps its notes and only has the store line added
// or updated. --refresh only touches releases that already have the line.
//
// Needs the `gh` command, signed in (GH_TOKEN in a workflow). The store is read
// without API keys: what counts is what the public can see there.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publicStore } from "./amo-api.mjs";
import { changelogSection } from "./changelog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- store-status -->";
const END = "<!-- /store-status -->";

function die(msg) {
  console.error(`github-release: ${msg}`);
  process.exit(1);
}

// Compares versions part by part as numbers, so 0.1.10 is newer than 0.1.9.
function compareVersions(a, b) {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

// The line saying whether `version` is on the store. `store` comes from publicStore().
export function storeLine(version, store) {
  const label = "**On addons.mozilla.org:**";
  if (store?.versions.includes(version)) {
    if (version === store.current) return `${label} yes. [Get Nepenthe for Firefox](${store.url}).`;
    return `${label} yes, as an older version. The store now installs ${store.current}. [All versions](${store.url}versions/).`;
  }
  if (store?.current && compareVersions(store.current, version) > 0) {
    return `${label} no. The store has ${store.current}. [Get Nepenthe for Firefox](${store.url}).`;
  }
  return `${label} not yet. A version shows up there once Mozilla has reviewed it, which can take days or weeks. This line is rechecked daily.`;
}

export const hasStoreLine = (body) => body.includes(START) && body.includes(END);

// `body` with the store line added at the end, or replaced if it's already there.
export function withStoreLine(body, line) {
  const block = `${START}\n${line}\n${END}`;
  if (!hasStoreLine(body)) return `${body.trim()}\n\n${block}\n`;
  return body.slice(0, body.indexOf(START)) + block + body.slice(body.indexOf(END) + END.length);
}

const gh = (args, input) => execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });

// The release's notes, or null if the tag has no release.
function releaseBody(tag) {
  try {
    return JSON.parse(gh(["release", "view", tag, "--json", "body"])).body;
  } catch (e) {
    if (/release not found/i.test(e.stderr ?? "")) return null;
    throw e;
  }
}

function publish(tag, store, dryRun) {
  const version = tag.replace(/^v/, "");
  const line = storeLine(version, store);
  const existing = releaseBody(tag);
  let body;
  if (existing === null) {
    const notes = changelogSection(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), version);
    if (!notes) die(`CHANGELOG.md has no "## ${version}" section, so there are no release notes for ${tag}.`);
    body = withStoreLine(notes, line);
  } else {
    body = withStoreLine(existing, line);
  }
  if (dryRun) {
    console.log(`${existing === null ? "Would create" : "Would update"} the release for ${tag} with these notes:\n\n${body}`);
  } else if (existing === null) {
    // --verify-tag: only release a tag that's already pushed, never create one.
    gh(["release", "create", tag, "--verify-tag", "--title", `Nepenthe ${version}`, "--notes-file", "-"], body);
    console.log(`Published the release for ${tag}.`);
  } else if (body !== existing) {
    gh(["release", "edit", tag, "--notes-file", "-"], body);
    console.log(`Updated the store line on ${tag}.`);
  } else {
    console.log(`${tag} is already up to date.`);
  }
}

function refresh(store, dryRun) {
  const releases = JSON.parse(gh(["release", "list", "--limit", "200", "--json", "tagName"]));
  for (const { tagName: tag } of releases) {
    const body = releaseBody(tag);
    if (!hasStoreLine(body)) continue;
    const next = withStoreLine(body, storeLine(tag.replace(/^v/, ""), store));
    if (next === body) continue;
    if (dryRun) {
      console.log(`Would update ${tag}:\n${storeLine(tag.replace(/^v/, ""), store)}\n`);
    } else {
      gh(["release", "edit", tag, "--notes-file", "-"], next);
      console.log(`Updated the store line on ${tag}.`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tag = args.find((a) => !a.startsWith("--"));
  if (!tag && !args.includes("--refresh")) die("give a tag, e.g. `node tools/github-release.mjs v0.1.6`, or --refresh.");
  if (tag && !/^v\d+(\.\d+)+$/.test(tag)) die(`"${tag}" doesn't look like a release tag such as v0.1.6.`);
  try {
    // If the store can't be reached, stop: better no update than a wrong line.
    const store = await publicStore();
    if (tag) publish(tag, store, dryRun);
    else refresh(store, dryRun);
  } catch (e) {
    die(e.stderr?.trim() || e.message);
  }
}
