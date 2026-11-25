# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Nepenthe is a Firefox extension (Manifest V3) that deletes history, cookies, site data, the downloads list and recently closed tabs once they're older than a limit the user picks. README.md has the user-facing rules and the limits of what Firefox lets an extension delete.

## Commands

There are no dependencies to install. `web-ext` is run through `npx` at a pinned version.

```bash
npm test                    # unit tests, fake browser API
node --test test/sweep.test.cjs                             # one test file
node --test --test-name-pattern="bad night" test/*.test.cjs # tests matching a name
npm run e2e                 # real headless Firefox, about 90 seconds; FIREFOX=/path/to/firefox to override
npm run lint                # web-ext lint
npm start                   # run from source in a fresh Firefox profile, reloads on save
npm run amo-status          # every version on addons.mozilla.org with its review status
npm run listing             # diff of the store listing against amo-metadata.json; `-- --push` updates the store
npm run wiki                # diff of what the GitHub wiki would gain from README.md; `-- --push` updates it
```

The GitHub wiki is generated from README.md by `tools/wiki.mjs`, one section per page. Documentation changes go in the README; never edit the wiki's pages directly. `npm run wiki -- --push` publishes, so run it only once the README change is on `main`. A renamed README heading that a page is built from fails `npm test` until `GROUPS` in the tool is updated.

## Getting a build into the user's own Firefox

Release Firefox only installs builds signed by Mozilla, and it's the only Firefox on this machine. So "a local build" means signing through addons.mozilla.org as an unlisted version:

```bash
npm run sign                # uploads the working tree as an unlisted version, writes web-ext-artifacts/*.xpi
npm run install-signed      # opens the newest signed .xpi in Firefox; the user clicks Add
```

- `npm run sign` is an upload to Mozilla, not a local step. A version number can be uploaded only once, in either channel, so the version in `manifest.json` must be one `npm run amo-status` doesn't list. For a build between releases, set a four-part version such as 0.1.5.1 in `manifest.json`, sign, then put the version back without committing it.
- Unlisted builds are signed automatically: no reviewer sees them and nothing is published. So signing needs no confirmation and is fine while a listed version waits for review. What's guarded is a listed submission, which only `npm run release` makes.
- `npm start` and loading `manifest.json` at `about:debugging` need no upload, but neither is a permanent install.

## Releasing

`npm run release -- <version>` does the whole release from `main`: it turns `## Unreleased` in CHANGELOG.md into the version's section, bumps `manifest.json` and `package.json`, runs the tests, e2e and lint, commits `Release <version>`, submits a listed version to addons.mozilla.org and tags `v<version>`. It doesn't push. `--dry-run` only checks. The README's Releasing section covers failures and retries.

Pushing the tag triggers `.github/workflows/release.yml`, which publishes a GitHub release from the changelog section with a line saying whether the version is on addons.mozilla.org. The workflow reruns daily to keep that line current, and reads the store without API keys (`publicStore` in `tools/amo-api.mjs`).

Rules that follow from how review works there:

- Reviews are done by people and take days to weeks. Releases are batched: don't run `npm run release` while `npm run amo-status` shows a version as `unreviewed`, and ask before adding `--even-if-pending`.
- Describe user-visible changes under `## Unreleased` in CHANGELOG.md as they're made. That text becomes the store's release notes and the GitHub release notes. Tooling and CI changes don't go there.
- `amo-reviewer-notes.txt` is sent to Mozilla's reviewers with every release. It explains each permission and the generated file, so update it in the same change that adds a permission or changes what a permission is used for.
- The listing's summary, description, homepage and tags come from `amo-metadata.json` and are pushed with `npm run listing -- --push`, with no new version and no review. That push changes the public store page, so ask before running it.
- The other tools sign their requests with API keys from `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` or the macOS keychain (`tools/amo-keys.mjs`).

## Architecture

The background page is non-persistent and loads five classic scripts in the order `manifest.json` lists them: `psl-data.js`, `domain.js`, `settings.js`, `sweep.js`, `background.js`. There are no ES modules and no bundler in `src/`. Each file is an IIFE that hangs one object on `globalThis` (`Domain`, `Settings`, `Sweep`) and also sets `module.exports`, which is how the `.cjs` unit tests `require` the same files. The options page loads `psl-data.js`, `domain.js` and `settings.js` the same way.

- `src/sweep.js` holds all the deletion logic and never touches the global `browser`. Every function takes `api`, so unit tests pass a fake that records calls. Work is split into `plan` / `planBadNight` (read state, decide what is stale), `summarize` (the preview shown to the user) and `execute` (delete, counting failures per step without stopping).
- `src/domain.js` groups hosts into sites using the bundled Public Suffix List. `src/psl-data.js` is generated by `npm run build-psl`; don't edit it by hand.
- `src/background.js` only schedules and routes: alarms, a queue so a sweep and a bad night can't overlap, and the `runtime.onMessage` cases (`preview`, `sweep`, `badNightPreview`, `badNight`, `schedule`) the options page calls.
- `options/` is the settings page, the only UI. Keep it plain: fix structure, skip decoration.

Things that must stay true:

- Storage holds only `settings` and the counts in `lastSweep`. Nothing records which sites were visited, failure reports carry no hostnames, and a bad night isn't recorded at all.
- A fresh install is off (`enabled: false`) until the user saves settings, and the first run is previewed first.
- A site expiring clears the whole HTTP cache, because Firefox's per-site cache clearing silently does nothing. The e2e test exists to catch API behaviour like this that a fake can't show, so run it after changing what `execute` calls.

`tools/` and the workflow are Node ES modules (`.mjs`) and aren't shipped: `web-ext-config.mjs` and `npm run package` leave them out of the extension.
