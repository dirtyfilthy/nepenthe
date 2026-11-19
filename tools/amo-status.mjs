// Shows Nepenthe's status on addons.mozilla.org: whether the listing is public,
// and every uploaded version with its channel and review status.
// Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET in the environment (see README).
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://addons.mozilla.org/api/v5";
const { WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret } = process.env;
if (!key || !secret) {
  console.error("Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first (see README).");
  process.exit(1);
}
const id = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;

// addons.mozilla.org wants a short-lived HS256 JWT per request.
function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: key, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `JWT ${token()}` } });
  if (!res.ok) {
    console.error(`addons.mozilla.org said HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

const addon = await get(`/addons/addon/${encodeURIComponent(id)}/`);
console.log(`Listing: ${addon.status}${addon.is_disabled ? " (disabled)" : ""}  ${addon.url}`);
console.log(`Public version: ${addon.current_version?.version ?? "none yet"}\n`);

let page = `/addons/addon/${encodeURIComponent(id)}/versions/?filter=all_with_unlisted&page_size=50`;
const rows = [];
while (page) {
  const r = await get(page);
  for (const v of r.results) rows.push([v.version, v.channel, v.file?.status ?? "?", (v.file?.created ?? "").slice(0, 10)]);
  page = r.next ? r.next.slice(API.length) : null;
}
console.log("Version   Channel   Review status   Uploaded");
for (const [version, channel, status, created] of rows) {
  console.log(`${version.padEnd(10)}${channel.padEnd(10)}${status.padEnd(16)}${created}`);
}
console.log('\n"unreviewed" means waiting for review. "public" means approved (listed) or signed (unlisted).');
