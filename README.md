# Nepenthe

Disappearing messages for your Firefox history. This guide is also on the [wiki](https://github.com/dirtyfilthy/nepenthe/wiki), one page per section.

You pick a time limit, and Nepenthe deletes:

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

## Bad night

The settings page has a **Forget the last 12 hours** button (you can change the number of hours). It deletes, right away:

- every history visit, download list entry and recently closed tab or window from that time
- search and form history from that time (Firefox can delete this "since" a time, though not "before" one)
- cookies and site data of every site you **first** visited in that time, plus the whole HTTP cache

Sites you'd visited before then keep their cookies, so you stay signed in, but their visits from that time are still deleted. Sites on the keep list keep their cookies too. It ignores which categories are ticked for the automatic sweep. Before deleting, it lists the sites that will lose their cookies and warns about any that are still open in a tab, since an open tab can put history and cookies straight back. Nothing about it is recorded in Nepenthe's storage.

## Install

Release builds of Firefox only install signed extensions, so pick one of these:

1. **Sign it yourself (permanent, any Firefox).** Create API keys at <https://addons.mozilla.org/developers/addon/api/key/> (sign in with a Mozilla account). In a terminal in this folder, run:
   ```bash
   export WEB_EXT_API_KEY='user:12345:67'   # "JWT issuer"
   export WEB_EXT_API_SECRET='...'          # "JWT secret"
   npm run sign
   ```
   On macOS you can keep the keys in your login keychain and skip the `export`s. Save them once, and the npm scripts read them from there whenever the variables aren't set (`-w` with no value prompts for it, so it stays out of your shell history):
   ```bash
   security add-generic-password -s nepenthe-amo -a WEB_EXT_API_KEY -w
   security add-generic-password -s nepenthe-amo -a WEB_EXT_API_SECRET -w
   ```
   This uploads the extension to Mozilla as **unlisted**: it's signed for you but not published on the store. It usually comes back within a few minutes as `web-ext-artifacts/*.xpi`. Run `npm run install-signed` to open the newest one in Firefox, then click **Add** (or open the file yourself with File → Open File). Add a version, e.g. `npm run install-signed -- 0.1.3`, for an older build. To ship an update, bump `version` in `manifest.json` and run `npm run sign` again.
2. **Firefox Developer Edition, Nightly or ESR.** Set `xpinstall.signatures.required` to `false` in `about:config`, run `npm run package`, then go to `about:addons` → gear menu → Install Add-on From File and pick `nepenthe.zip`.
3. **Try it out.** Go to `about:debugging#/runtime/this-firefox` → Load Temporary Add-on and pick `manifest.json`. A temporary add-on is removed when Firefox restarts, so this isn't good for real use.

After installing, the settings page opens. Nepenthe stays **off** until you tick "Automatically delete" and save. Before turning on, it shows what the first run would delete and asks you to confirm. You can reopen settings from the toolbar button.

## What it can't erase

These are limits of what Firefox lets extensions do:

- **Search and form history.** This is what you've typed into search boxes and web forms. Firefox offers extensions no way to delete it by site or once it's older than a limit (only everything since a time, which the [Bad night](#bad-night) button uses), so stop Firefox saving it (see [Turn off search and form history](#turn-off-search-and-form-history)).
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

Turning it off stops Firefox saving new entries. It doesn't erase what's already saved. To erase that, click **Clear all saved search and form history** on Nepenthe's settings page. It removes every entry at once, because Firefox can't remove them by age. Saved passwords, addresses and cards aren't touched.

## Development

```bash
npm start                   # run Nepenthe in a fresh Firefox profile; reloads on save
npm test                    # unit tests (fake browser API)
npm run e2e                 # real headless Firefox, ~90s; FIREFOX=/path/to/firefox to override
npm run release -- 0.1.6    # release a new version to addons.mozilla.org (see Releasing)
npm run amo-status          # review status of every version on addons.mozilla.org
npm run sign                # sign an unlisted build on addons.mozilla.org
npm run install-signed      # install the newest signed build in Firefox
npm run build-psl -- public_suffix_list.dat   # refresh src/psl-data.js from a new Public Suffix List
npm run wiki                # show what the wiki would gain from this README; add `-- --push` to update it
```

The [wiki](https://github.com/dirtyfilthy/nepenthe/wiki) is a copy of this README, one section per page, built by `tools/wiki.mjs`. Edit the README, not the wiki: the next `npm run wiki -- --push` overwrites the wiki's pages.

### Releasing

Add-on reviews on addons.mozilla.org are done by people and can take days to weeks, so release in batches: about once a month, once there's something polished, and never while a version is still waiting for review. Uploading a newer listed version can cost the add-on its place in the queue. Between releases, try changes with `npm start`, or with `npm run sign` and `npm run install-signed` for a build that stays installed. Unlisted builds are signed automatically, with no reviewer and nothing published, so they're fine at any time.

1. As you make changes, describe them for users under `## Unreleased` at the top of [CHANGELOG.md](CHANGELOG.md).
2. On `main`, with everything committed and the API keys exported or in the keychain (see Install), run `npm run release -- 0.1.6` with the new version. Add `--dry-run` to only check things and see the release notes.

The script turns `## Unreleased` into `## 0.1.6 (date)`, sets the version in `manifest.json` and `package.json`, and runs the unit tests, the Firefox end-to-end test and `web-ext lint`. If any of those fail, it puts the files back and stops. Otherwise it commits `Release 0.1.6` and submits that commit to addons.mozilla.org as a public version. The changelog section becomes the release notes, and a zip of the source from git goes along with it, since reviewers need the source of the generated `src/psl-data.js`. Once the submission is accepted it tags `v0.1.6` and prints the `git push` command; it doesn't push on its own.

`npm run release` checks addons.mozilla.org first and stops if a version is still waiting for review. A dry run only reports it. For a critical fix that can't wait, add `--even-if-pending`. `npm run sign` doesn't check, and refuses `--channel listed`.

If the submission fails, fix the problem and run `npm run release -- --submit-only` to retry it. A version number can only be uploaded once, so if `npm run amo-status` shows the failed version arrived anyway, release a newer one instead.

Pushing the tag publishes a GitHub release ([.github/workflows/release.yml](.github/workflows/release.yml)). Its notes are the version's changelog section plus a line saying whether that version is on addons.mozilla.org. A new version starts as "not yet", and the workflow rechecks every day and updates the line once Mozilla approves it. To publish a release for a tag that's already pushed, run the workflow by hand from the Actions tab and give it the tag. `node tools/github-release.mjs v0.1.6 --dry-run` shows the notes without publishing.

The store listing text in `amo-metadata.json` was only used for the first public submission (0.1.4). To change the listing now, edit it on addons.mozilla.org.

### Layout

- `src/sweep.js`: decides what is stale and deletes it.
- `src/domain.js`: groups hosts into sites.
- `src/background.js`: scheduling and messages.
- `options/`: the settings page.

## Thanks

- [Dustpan](https://addons.mozilla.org/firefox/addon/dustpan-cookie-cleaner/) by C4rcer, a cookie cleaner that works when you close a site's last tab. Reading its code showed that Firefox only lists a container's cookie store while one of its tabs is open, which is why Nepenthe now asks for the list of containers itself.

## License

MIT, see [LICENSE](LICENSE). `src/psl-data.js` is generated from the [Public Suffix List](https://publicsuffix.org/), which is under MPL-2.0.
