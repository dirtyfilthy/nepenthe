// `npm run install-signed`: opens the newest signed build in web-ext-artifacts/
// in Firefox, which asks you to confirm the install.
//
//   npm run install-signed                 newest version
//   npm run install-signed -- 0.1.3        that version
//   npm run install-signed -- path/to.xpi  that file
//
// Signed builds come from `npm run sign`. Set FIREFOX to use a particular
// Firefox app (macOS, e.g. "Firefox Developer Edition") or binary (elsewhere).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = join(ROOT, "web-ext-artifacts");

function die(msg) {
  console.error(`install-signed: ${msg}`);
  process.exit(1);
}

// web-ext names signed builds <addon id>-<version>.xpi.
function builds() {
  if (!existsSync(ARTIFACTS)) return [];
  return readdirSync(ARTIFACTS)
    .map((name) => ({ name, version: name.match(/-(\d+(?:\.\d+)*)\.xpi$/)?.[1] }))
    .filter((b) => b.version);
}

// Compares versions part by part as numbers, so 0.1.10 is newer than 0.1.9 and 0.1.4.1 than 0.1.4.
function compareVersions(a, b) {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

const arg = process.argv[2];
let file;
if (arg?.endsWith(".xpi")) {
  file = resolve(arg);
  if (!existsSync(file)) die(`there's no ${file}.`);
} else {
  const all = builds().sort((a, b) => compareVersions(b.version, a.version));
  if (!all.length) die("no signed builds in web-ext-artifacts/. Make one with `npm run sign`.");
  const pick = arg ? all.find((b) => b.version === arg) : all[0];
  if (!pick) die(`no signed build of ${arg}. There are: ${all.map((b) => b.version).join(", ")}.`);
  file = join(ARTIFACTS, pick.name);
}

console.log(`Opening ${file} in Firefox. Click Add in Firefox to install it.`);
const CANT_OPEN = "couldn't open Firefox. Set FIREFOX to its app name (macOS) or path, or open the file in Firefox yourself.";
if (process.platform === "darwin") {
  try {
    execFileSync("open", ["-a", process.env.FIREFOX || "Firefox", file], { stdio: "inherit" });
  } catch {
    die(CANT_OPEN);
  }
} else {
  // Don't wait for Firefox to exit if this starts it.
  const child = spawn(process.env.FIREFOX || "firefox", [file], { detached: true, stdio: "ignore" });
  child.on("error", () => die(CANT_OPEN));
  child.unref();
}
