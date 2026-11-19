// `npm run sign`: signs an unlisted build with web-ext, using the API keys
// from the environment or the macOS keychain (see amo-keys.mjs).
// Extra arguments are passed on to `web-ext sign`.
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAmoKeys, MISSING_KEYS_HELP } from "./amo-keys.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!loadAmoKeys()) {
  console.error(`sign: ${MISSING_KEYS_HELP}`);
  process.exit(1);
}
try {
  execFileSync("npx", ["web-ext@10.8.0", "sign", ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
