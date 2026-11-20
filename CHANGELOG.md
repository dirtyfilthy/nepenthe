# Changelog

## 0.1.6 (2026-11-20)

- **Cookies in containers you aren't using are now deleted.** Firefox only tells an extension about a container while one of its tabs is open, so a stale site's cookies in a container with no tab open were skipped until you next used that container. Nepenthe now asks Firefox for the full list of containers on every check, which needs the container permission. Found by reading the code of [Dustpan](https://addons.mozilla.org/firefox/addon/dustpan-cookie-cleaner/), a cookie cleaner by C4rcer that works around the same Firefox behaviour. Thank you.
- **Settings page laid out as cards.** Settings, Now, Bad night, and Search and form history each get their own card, and each card's buttons act only on what is in it. Save is now "Save settings" at the foot of the Settings card.
- **Unsaved changes are flagged.** Editing a setting shows "Unsaved changes." beside Save settings until you save or put it back, and Firefox asks before closing or reloading the page with edits pending. Before, a change you forgot to save was dropped without a word, including turning deletion off.
- Status under Now is a row per fact instead of one sentence, and the preview lists one site per row.
- The steps for turning off search and form history are a numbered list behind "How to stop Firefox saving it".
- Number fields, selects and buttons share one height; checkbox notes sit on their own line under the label.
- The Save button's text is readable in dark mode, and buttons and fields have a visible border.
- New icon: a purple tile of dots that thin out toward the bottom, in place of the clock. The settings tab shows it too.
- **The preview counts only what will be deleted.** With a category unticked, the preview and the "turn on" question no longer count that category's sites, cookies or history pages.
- Preview and "Delete expired now" say so when they go by the saved settings while the form has unsaved changes.
- Status under Now updates by itself after an automatic run, without reloading the page.
- Problems are named in plain words ("local storage", "search and form history") instead of internal names, and a failed save or "Delete expired now" shows a message instead of doing nothing.
- Wording: "1 day" and "1 cookie" instead of "1 days" and "1 cookies", and times are shown without seconds.

## 0.1.5 (2026-11-19)

- **Bad night button.** "Forget the last 12 hours" on the settings page (any number of hours) deletes every history visit, download list entry, recently closed tab and search or form entry from that time. Sites first visited in that time also lose their cookies and site data, and the browser cache is cleared. Sites visited before then keep their cookies, and so do sites on the keep list. It asks first, lists the sites that will lose their cookies, and warns about any still open in a tab. Nothing about it is recorded.

## 0.1.4 (2026-11-17)

- First version submitted for a public listing on addons.mozilla.org. Same as 0.1.3, renumbered because 0.1.3 was already used by an unlisted signing.

## 0.1.3 (2026-11-17)

- Listing text and metadata for addons.mozilla.org, and `npm run publish` to submit a public version.

## 0.1.2 (2026-11-17)

- **Clear all saved search and form history** button on the settings page.
- Instructions for turning off search and form history in Firefox.
- MIT license.

## 0.1.1 (2026-11-17)

- First release: history, cookies, site data, cache, downloads list and recently closed tabs disappear after a time limit you choose, with a keep list and a preview before the first run.
