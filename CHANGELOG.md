# Changelog

## Unreleased

- **Settings page laid out as cards.** Settings, Now, Bad night, and Search and form history each get their own card, and each card's buttons act only on what is in it. Save is now "Save settings" at the foot of the Settings card.
- Status under Now is a row per fact instead of one sentence, and the preview lists one site per row.
- The steps for turning off search and form history are a numbered list behind "How to stop Firefox saving it".
- Number fields, selects and buttons share one height; checkbox notes sit on their own line under the label.
- The Save button's text is readable in dark mode, and buttons and fields have a visible border.
- New icon: a purple tile of dots that thin out toward the bottom, in place of the clock.

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
