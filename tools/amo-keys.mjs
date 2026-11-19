// Finds the addons.mozilla.org API keys for the tools in this folder.
//
// WEB_EXT_API_KEY / WEB_EXT_API_SECRET in the environment win. Otherwise, on
// macOS, each is read from the login keychain: a generic password with service
// "nepenthe-amo" and the variable's name as the account. The values are put
// into process.env so child processes (web-ext) see them too.
import { execFileSync } from "node:child_process";

export const KEYCHAIN_SERVICE = "nepenthe-amo";
const NAMES = ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"];

function fromKeychain(account) {
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// Returns true when both keys are available.
export function loadAmoKeys() {
  for (const name of NAMES) {
    if (!process.env[name]) {
      const value = fromKeychain(name);
      if (value) process.env[name] = value;
    }
  }
  return NAMES.every((name) => process.env[name]);
}

export const MISSING_KEYS_HELP =
  `no addons.mozilla.org API keys. Export WEB_EXT_API_KEY and WEB_EXT_API_SECRET, ` +
  `or on macOS save them in the keychain under service "${KEYCHAIN_SERVICE}" (see README).`;
