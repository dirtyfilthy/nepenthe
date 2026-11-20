// Settings for `npx web-ext`. API keys come from the environment
// (WEB_EXT_API_KEY / WEB_EXT_API_SECRET), filled in from the macOS keychain by
// tools/amo-keys.mjs when you use the npm scripts. They're never stored here.
export default {
  ignoreFiles: ["test", "tools", "README.md", "CHANGELOG.md", "CLAUDE.md", "package.json", "web-ext-config.mjs", "nepenthe.zip", "web-ext-artifacts", "amo-metadata.json", "nepenthe-source.zip"],
  sign: { channel: "unlisted" },
};
