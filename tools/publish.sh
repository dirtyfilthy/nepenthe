#!/bin/sh
# Submits the current commit to addons.mozilla.org as a public (listed) version.
# Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET in the environment.
# The listing text in amo-metadata.json is only used for the first listed version;
# after that, edit the listing on the AMO website.
set -eu
cd "$(dirname "$0")/.."

if [ -z "${WEB_EXT_API_KEY:-}" ] || [ -z "${WEB_EXT_API_SECRET:-}" ]; then
  echo "Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first (see README)." >&2
  exit 1
fi
# Reviewers get the source from git, so it must match what's being uploaded.
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit your changes first: the source upload is built from the last commit." >&2
  exit 1
fi

git archive --format=zip -o nepenthe-source.zip HEAD
npx web-ext@10.8.0 sign --channel=listed --amo-metadata=amo-metadata.json --upload-source-code=nepenthe-source.zip
