// A small client for the addons.mozilla.org API, for the tools in this folder.
// Everything reads, except patchAddon, which edits the store listing.
// Call loadAmoKeys() from amo-keys.mjs first: requests are signed with
// WEB_EXT_API_KEY / WEB_EXT_API_SECRET from the environment.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://addons.mozilla.org/api/v5";

export const addonId = () => JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;

// addons.mozilla.org wants a short-lived HS256 JWT per request.
function token() {
  const { WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret } = process.env;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: key, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

// GETs a path under the API root and returns the parsed JSON. Throws on any HTTP error.
export async function amoGet(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `JWT ${token()}` } });
  if (!res.ok) throw new Error(`addons.mozilla.org said HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export const getAddon = () => amoGet(`/addons/addon/${encodeURIComponent(addonId())}/`);

// Changes the listing's own fields (summary, description, tags and so on) without
// uploading a version. fields is the JSON body; fields left out stay as they are.
export async function patchAddon(fields) {
  const res = await fetch(`${API}/addons/addon/${encodeURIComponent(addonId())}/`, {
    method: "PATCH",
    headers: { Authorization: `JWT ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`addons.mozilla.org said HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Every uploaded version, listed and unlisted, newest first:
// [{ version, channel, status, created }]. status is the file's review status,
// e.g. "unreviewed" (waiting for review), "public" or "disabled".
export async function listVersions() {
  let page = `/addons/addon/${encodeURIComponent(addonId())}/versions/?filter=all_with_unlisted&page_size=50`;
  const versions = [];
  while (page) {
    const r = await amoGet(page);
    for (const v of r.results) {
      versions.push({ version: v.version, channel: v.channel, status: v.file?.status ?? "?", created: (v.file?.created ?? "").slice(0, 10) });
    }
    page = r.next ? r.next.slice(API.length) : null;
  }
  return versions;
}

// What anyone can see on the store, asked without API keys:
// { url, current, versions } with the listing's address, the version it installs
// and every approved public version. null while the listing itself isn't public.
export async function publicStore() {
  const get = async (url) => {
    const res = await fetch(url);
    // A listing that isn't public answers 401 without keys; an unknown add-on answers 404.
    if ([401, 403, 404].includes(res.status)) return null;
    if (!res.ok) throw new Error(`addons.mozilla.org said HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const base = `${API}/addons/addon/${encodeURIComponent(addonId())}/`;
  const addon = await get(base);
  if (!addon || addon.status !== "public") return null;
  const versions = [];
  for (let page = `${base}versions/?page_size=50`; page; ) {
    const r = await get(page);
    if (!r) break;
    versions.push(...r.results.map((v) => v.version));
    page = r.next;
  }
  return { url: addon.url, current: addon.current_version?.version ?? null, versions };
}

// Versions still waiting for a reviewer.
export const awaitingReview = (versions) => versions.filter((v) => v.status === "unreviewed");

// Used by release: submitting a listed version while another waits for review
// can cost the add-on its place in the queue, and adds to reviewers' work.
export const OVERRIDE_FLAG = "--even-if-pending";
export const pendingList = (pending) =>
  "addons.mozilla.org still has versions waiting for review:\n" +
  pending.map((v) => `  ${v.version} (${v.channel}, uploaded ${v.created})`).join("\n");
export const PENDING_ADVICE =
  "Wait until they're reviewed (`npm run amo-status`), and test with `npm start` or `npm run sign` meanwhile.\n" +
  `For a critical fix that can't wait, add ${OVERRIDE_FLAG}.`;
