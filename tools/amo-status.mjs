// Shows Nepenthe's status on addons.mozilla.org: whether the listing is public,
// and every uploaded version with its channel and review status.
// Needs the addons.mozilla.org API keys in the environment or the macOS keychain (see README).
import { loadAmoKeys, MISSING_KEYS_HELP } from "./amo-keys.mjs";
import { getAddon, listVersions } from "./amo-api.mjs";

if (!loadAmoKeys()) {
  console.error(`amo-status: ${MISSING_KEYS_HELP}`);
  process.exit(1);
}

try {
  const addon = await getAddon();
  const versions = await listVersions();
  // current_version is the newest listed version even before it's approved,
  // so only call it public once the listing itself is.
  const label = addon.status === "public" ? "Public version" : "Latest listed version (not public yet)";
  console.log(`Listing: ${addon.status}${addon.is_disabled ? " (disabled)" : ""}  ${addon.url}`);
  console.log(`${label}: ${addon.current_version?.version ?? "none yet"}\n`);
  console.log("Version   Channel   Review status   Uploaded");
  for (const { version, channel, status, created } of versions) {
    console.log(`${version.padEnd(10)}${channel.padEnd(10)}${status.padEnd(16)}${created}`);
  }
  console.log('\n"unreviewed" means waiting for review. "public" means approved (listed) or signed (unlisted).');
} catch (e) {
  console.error(`amo-status: ${e.message}`);
  process.exit(1);
}
