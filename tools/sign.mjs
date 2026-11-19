// `npm run sign`: signs an unlisted build with web-ext, using the API keys
// from the environment or the macOS keychain (see amo-keys.mjs).
// Extra arguments are passed on to `web-ext sign`.
//
// It refuses while any version is still waiting for review on addons.mozilla.org,
// unless you add --even-if-pending. To try a build locally, use `npm start` instead.
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAmoKeys, MISSING_KEYS_HELP } from "./amo-keys.mjs";
import { listVersions, awaitingReview, pendingList, PENDING_ADVICE, OVERRIDE_FLAG } from "./amo-api.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!loadAmoKeys()) {
  console.error(`sign: ${MISSING_KEYS_HELP}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const evenIfPending = args.includes(OVERRIDE_FLAG);
let pending;
try {
  pending = awaitingReview(await listVersions());
} catch (e) {
  console.error(`sign: couldn't check the addons.mozilla.org review queue: ${e.message}`);
  process.exit(1);
}
if (pending.length && !evenIfPending) {
  console.error(`sign: ${pendingList(pending)}\n${PENDING_ADVICE}`);
  process.exit(1);
}

try {
  execFileSync("npx", ["web-ext@10.8.0", "sign", ...args.filter((a) => a !== OVERRIDE_FLAG)], { cwd: ROOT, stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
