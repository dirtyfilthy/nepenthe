// Settings for `npx web-ext`. API keys are read from the environment
// (WEB_EXT_API_KEY / WEB_EXT_API_SECRET), never stored here.
export default {
  ignoreFiles: ["test", "tools", "README.md", "package.json", "web-ext-config.mjs", "nepenthe.zip", "web-ext-artifacts"],
  sign: { channel: "unlisted" },
};
