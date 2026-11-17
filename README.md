# Nepenthe

Disappearing messages for your Firefox history. You pick a time limit, and Nepenthe deletes:

| What | Rule |
|---|---|
| History | Every visit older than the limit, including old visits to sites you still use. |
| Cookies | All cookies of any site you haven't visited within the limit, in every container. Third-party (partitioned) cookies follow the site they were set under. |
| Site data | localStorage, IndexedDB and service workers of those same sites, plus the whole HTTP cache whenever at least one site expires. |
| Downloads list | Entries older than the limit. The downloaded files stay on disk. |
| Recently closed tabs/windows | Entries older than the limit. |

A site counts as active if it has a visit within the limit or is open in a tab. `www.example.com`, `mail.example.com` and `example.com` count as one site. `alice.github.io` and `bob.github.io` count as two sites, because sites are grouped using the bundled Public Suffix List.

Sites on the keep list never lose their cookies or site data, so you stay signed in. Their history still disappears.

Nepenthe checks every 15 minutes, or more often when the limit is short, and also a minute after Firefox starts. If Firefox has been closed for longer than the limit, the first check after startup deletes everything that expired while it was closed.

Nepenthe doesn't keep its own record of sites. Its storage holds only your settings and the counts from the last run.

## Install

Release builds of Firefox only install signed extensions, so pick one of these:

1. **Sign it yourself (permanent, any Firefox).** Create API keys at <https://addons.mozilla.org/developers/addon/api/key/> (sign in with a Mozilla account). In a terminal in this folder, run:
   ```bash
   export WEB_EXT_API_KEY='user:12345:67'   # "JWT issuer"
   export WEB_EXT_API_SECRET='...'          # "JWT secret"
   npm run sign
   ```
   This uploads the extension to Mozilla as **unlisted**: it's signed for you but not published on the store. It usually comes back within a few minutes as `web-ext-artifacts/*.xpi`. Open that file in Firefox (File → Open File, or drag it into a window) to install it. To ship an update, bump `version` in `manifest.json` and run `npm run sign` again.
2. **Firefox Developer Edition, Nightly or ESR.** Set `xpinstall.signatures.required` to `false` in `about:config`, run `npm run package`, then go to `about:addons` → gear menu → Install Add-on From File and pick `nepenthe.zip`.
3. **Try it out.** Go to `about:debugging#/runtime/this-firefox` → Load Temporary Add-on and pick `manifest.json`. A temporary add-on is removed when Firefox restarts, so this isn't good for real use.

After installing, the settings page opens. Nepenthe stays **off** until you tick "Automatically delete" and save. Before turning on, it shows what the first run would delete and asks you to confirm. You can reopen settings from the toolbar button.

## What it can't erase

These are limits of what Firefox lets extensions do:

- **Search and form history.** This is what you've typed into search boxes and web forms. Firefox offers extensions no way to delete it by site or by age, so stop Firefox saving it (see [Turn off search and form history](#turn-off-search-and-form-history)).
- **Site permissions and per-site settings,** such as notifications, camera, zoom and cookie exceptions, plus **HSTS records.** Extensions can't reach these.
- **Bookmarks and saved passwords.** These are kept on purpose. A bookmarked page loses its visits but the bookmark stays.
- **Clearing one site's cache.** Firefox's per-site cache clearing silently does nothing, because network partitioning (on by default) stores every cache entry under the top-level site and the per-site delete doesn't match those entries. So whenever a site expires, Nepenthe clears the whole HTTP cache. Pages load a little slower until the cache refills, but no cached file outlives its site.
- **Storage that third-party iframes kept under a stale site.** Their cookies are deleted, but their localStorage and IndexedDB can't be targeted. Data with no cookie and no history entry is invisible to extensions.
- **Firefox Sync.** Other devices keep whatever they already synced.
- **If Firefox is set to "Never remember history",** no site ever counts as active, so every site not open in a tab loses its cookies on each run. The preview warns about this.

## Turn off search and form history

Nepenthe can't expire what you type into search boxes and web forms, so turn it off in Firefox instead. Keep browsing history on, because Nepenthe uses it to tell which sites you still visit.

1. Open Firefox Settings (`about:preferences`) and go to **Privacy & Security**.
2. Under **History**, choose **Customize history**.
3. Click **Choose what you want Firefox to remember**.
4. Untick **Remember search and form history**. Leave **Remember browsing and download history** ticked.

Older Firefox versions show a "Firefox will" menu instead: set it to **Use custom settings for history**, then untick **Remember search and form history**.

On any version, you can instead set `browser.formfill.enable` to `false` in `about:config`.

Turning it off stops Firefox saving new entries. It doesn't erase what's already saved.

## Development

```bash
npm test                    # unit tests (fake browser API)
npm run e2e                 # real headless Firefox, ~90s; FIREFOX=/path/to/firefox to override
npm run build-psl -- public_suffix_list.dat   # refresh src/psl-data.js from a new Public Suffix List
```

Layout:
- `src/sweep.js`: decides what is stale and deletes it.
- `src/domain.js`: groups hosts into sites.
- `src/background.js`: scheduling and messages.
- `options/`: the settings page.

## License

MIT, see [LICENSE](LICENSE). `src/psl-data.js` is generated from the [Public Suffix List](https://publicsuffix.org/), which is under MPL-2.0.
