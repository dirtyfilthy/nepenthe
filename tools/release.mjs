// Releases a new version to addons.mozilla.org as a public (listed) version.
//
//   npm run release -- 0.1.6            bump, test, commit, submit, tag
//   npm run release -- 0.1.6 --dry-run  only check and show the release notes
//   npm run release -- --submit-only    resubmit the release commit at HEAD after a failed submission
//
// It refuses while a version is still waiting for review on addons.mozilla.org,
// unless you add --even-if-pending (for a critical fix).
//
// Write what changed under "## Unreleased" in CHANGELOG.md first. That section
// becomes the version's heading and its addons.mozilla.org release notes.
// Needs the addons.mozilla.org API keys in the environment or the macOS keychain (see README).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAmoKeys, MISSING_KEYS_HELP } from "./amo-keys.mjs";
import { listVersions, awaitingReview, pendingList, PENDING_ADVICE, OVERRIDE_FLAG } from "./amo-api.mjs";
import { changelogSection } from "./changelog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_EXT = "web-ext@10.8.0";
const VERSION_FILES = ["manifest.json", "package.json"];
const RELEASE_FILES = ["CHANGELOG.md", ...VERSION_FILES];

const read = (f) => readFileSync(join(ROOT, f), "utf8");
const write = (f, s) => writeFileSync(join(ROOT, f), s);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function die(msg) {
  console.error(`\nrelease: ${msg}`);
  process.exit(1);
}

const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const currentVersion = () => JSON.parse(read("manifest.json")).version;
const tagExists = (v) => git("tag", "--list", `v${v}`) !== "";

// addons.mozilla.org shows release notes as plain text, so drop Markdown emphasis.
const plainText = (md) => md.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

function setVersion(file, version) {
  const text = read(file);
  const next = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (next === text) die(`couldn't find the version in ${file}`);
  write(file, next);
}

function submit(version) {
  const notes = changelogSection(read("CHANGELOG.md"), version);
  if (!notes) die(`CHANGELOG.md has no "## ${version}" section.`);
  const dir = mkdtempSync(join(tmpdir(), "nepenthe-release-"));
  try {
    // Release notes come from the changelog, so they're never stale in amo-metadata.json.
    const metadata = JSON.parse(read("amo-metadata.json"));
    metadata.version = { ...metadata.version, release_notes: { "en-US": plainText(notes) } };
    const metadataFile = join(dir, "amo-metadata.json");
    writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    // Reviewers need the source of the generated src/psl-data.js, taken from the release commit.
    const sourceZip = join(dir, "nepenthe-source.zip");
    run("git", ["archive", "--format=zip", "-o", sourceZip, "HEAD"]);
    // Don't wait for approval: a listed review takes days, and web-ext's default
    // 15-minute wait would end in a timeout error after a successful upload.
    run("npx", [WEB_EXT, "sign", "--channel=listed", "--approval-timeout=0", `--amo-metadata=${metadataFile}`, `--upload-source-code=${sourceZip}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Stops if a version is waiting for review. A dry run only reports it.
async function checkReviewQueue() {
  if (!loadAmoKeys()) {
    console.log("Couldn't check the addons.mozilla.org review queue: no API keys.\n");
    return;
  }
  let pending;
  try {
    pending = awaitingReview(await listVersions());
  } catch (e) {
    die(`couldn't check the addons.mozilla.org review queue: ${e.message}`);
  }
  if (!pending.length) return;
  if (evenIfPending) {
    console.log(`${pendingList(pending)}\nGoing ahead anyway because of ${OVERRIDE_FLAG}.\n`);
  } else if (dryRun) {
    console.log(`A real release would stop here. ${pendingList(pending)}\n${PENDING_ADVICE}`);
  } else {
    die(`${pendingList(pending)}\n${PENDING_ADVICE}`);
  }
}

function finish(version) {
  git("tag", "-a", `v${version}`, "-m", `Nepenthe ${version}`);
  console.log(`\nSubmitted ${version} to addons.mozilla.org and tagged v${version}.`);
  console.log("Check its review status with `npm run amo-status`. To publish the commit and tag to GitHub, run:");
  console.log(`  git push origin main v${version}`);
  console.log("Pushing the tag also publishes the GitHub release.");
}

// --- main ---------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const submitOnly = args.includes("--submit-only");
const evenIfPending = args.includes(OVERRIDE_FLAG);
const version = submitOnly ? currentVersion() : args.find((a) => !a.startsWith("--"));

if (!submitOnly && !parse(version || "")) die("give the new version, e.g. `npm run release -- 0.1.6`.");
if (!dryRun && !loadAmoKeys()) die(MISSING_KEYS_HELP);
if (!dryRun && git("rev-parse", "--abbrev-ref", "HEAD") !== "main") die("switch to main first: releases are made from main.");
if (!dryRun && git("status", "--porcelain")) die("commit or stash your changes first: the release is built from a commit.");
if (tagExists(version)) die(`v${version} is already tagged, so it's already released.`);
await checkReviewQueue();

if (submitOnly) {
  if (git("log", "-1", "--format=%s") !== `Release ${version}`) {
    die(`HEAD isn't the "Release ${version}" commit. --submit-only only retries a submission that failed.`);
  }
  submit(version);
  finish(version);
  process.exit(0);
}

const current = currentVersion();
if (!newer(version, current)) die(`${version} must be newer than the current version, ${current}.`);
const changelog = read("CHANGELOG.md");
const unreleased = changelogSection(changelog, "Unreleased");
if (!unreleased) die('write what changed under "## Unreleased" in CHANGELOG.md first.');

console.log(`Releasing ${current} → ${version}. Release notes:\n\n${plainText(unreleased)}\n`);
if (dryRun) {
  console.log("Dry run: nothing changed.");
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
write("CHANGELOG.md", changelog.replace(/^## Unreleased$/m, `## ${version} (${date})`));
for (const f of VERSION_FILES) setVersion(f, version);

try {
  run("npm", ["test"]);
  run("npm", ["run", "e2e"]);
  run("npx", [WEB_EXT, "lint"]);
} catch {
  git("checkout", "--", ...RELEASE_FILES);
  die("a check failed, so nothing was released. The version and changelog are back as they were.");
}

git("commit", "-m", `Release ${version}`, "--", ...RELEASE_FILES);
try {
  submit(version);
} catch {
  die(
    `submitting to addons.mozilla.org failed. The "Release ${version}" commit is in place but not tagged.\n` +
      "Fix the problem and run `npm run release -- --submit-only`. If the upload did reach addons.mozilla.org,\n" +
      `that version number is used up: check with \`npm run amo-status\`, and if ${version} is listed there,\n` +
      "add a newer version instead."
  );
}
finish(version);
