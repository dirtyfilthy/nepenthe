// Reads CHANGELOG.md for the release tools.

// The body of a "## <heading>" or "## <heading> (date)" section, or null.
export function changelogSection(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `## ${heading}` || l.startsWith(`## ${heading} (`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}
