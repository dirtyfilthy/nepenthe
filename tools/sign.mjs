// `npm run sign`: signs an unlisted build with web-ext, using the API keys
// from the environment or the macOS keychain (see amo-keys.mjs).
// Extra arguments are passed on to `web-ext sign`.
//
// Unlisted builds are signed automatically: no reviewer looks at them and
// nothing is published, so this doesn't check the review queue. Listed
// versions are submitted only by `npm run release`, which does.
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAmoKeys, MISSING_KEYS_HELP } from "./amo-keys.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.some((a, i) => a === "--channel=listed" || (a === "listed" && args[i - 1] === "--channel"))) {
  console.error("sign: this only signs unlisted builds. Submit a listed version with `npm run release`.");
  process.exit(1);
}

if (!loadAmoKeys()) {
  console.error(`sign: ${MISSING_KEYS_HELP}`);
  process.exit(1);
}

try {
  execFileSync("npx", ["web-ext@10.8.0", "sign", ...args], { cwd: ROOT, stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
