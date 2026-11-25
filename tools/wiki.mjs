// Rebuilds the GitHub wiki from README.md, so the wiki is never edited by hand.
//
//   node tools/wiki.mjs          show what would change on the wiki
//   node tools/wiki.mjs --push   commit the change to the wiki and push it
//
// The README is the documentation. Each wiki page is one of its sections, with
// links to other sections turned into links between pages and links to files
// turned into links to the repository. Home and the sidebar are built from the
// list of pages below. A page someone added on the wiki by hand is left alone.
//
// Needs `git` with push access to the wiki. GitHub only creates a wiki's
// repository when its first page is saved in the browser.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The wiki's pages in sidebar order. `from` picks the page's text out of the
// parsed README, and `anchors` are the README headings that now live on the page.
const GROUPS = [
  {
    name: "Using it",
    pages: [
      {
        title: "What gets deleted",
        blurb: "the rule for each kind of data, which sites count as active, and the keep list.",
        from: (r) => afterFirstParagraph(r.intro),
      },
      {
        title: "Bad night",
        blurb: "forget the last few hours right away.",
        anchors: ["Bad night"],
        from: (r) => section(r, "Bad night").body,
      },
      {
        title: "What it cannot erase",
        blurb: "the limits of what Firefox lets an extension delete.",
        anchors: ["What it can't erase"],
        from: (r) => section(r, "What it can't erase").body,
      },
      {
        title: "Turn off search and form history",
        blurb: "the one thing you have to switch off in Firefox yourself.",
        anchors: ["Turn off search and form history"],
        from: (r) => section(r, "Turn off search and form history").body,
      },
    ],
  },
  {
    name: "Building it",
    pages: [
      {
        title: "Install from source",
        blurb: "sign your own build, or load it temporarily.",
        anchors: ["Install"],
        from: (r) => section(r, "Install").body,
      },
      {
        title: "Development",
        blurb: "commands and code layout.",
        anchors: ["Development", "Layout"],
        from: (r) =>
          `${section(r, "Development").body}\n\n## Layout\n\n${section(r, "Development", "Layout").body}\n\nReleases are covered in [[Releasing]].`,
      },
      {
        title: "Releasing",
        blurb: "how a version gets to addons.mozilla.org.",
        anchors: ["Releasing"],
        from: (r) => section(r, "Development", "Releasing").body,
      },
    ],
  },
];

// Home's opening words. Everything else on the wiki comes from the README.
const HOME_INTRO = [
  "Nepenthe is a Firefox extension that gives your browsing history disappearing messages. You pick a time limit, and history, cookies, site data, the downloads list and recently closed tabs are deleted once they're older than it.",
  "",
  "It starts switched off. Before the first run it shows what would be deleted and asks you to confirm. It keeps no record of the sites you visit and sends nothing anywhere.",
  "",
  "[Install Nepenthe from addons.mozilla.org](https://addons.mozilla.org/firefox/addon/nepenthe/).",
].join("\n");

// Places where the README names another section in plain words.
const MENTIONS = [
  ["(see Install)", "(see [[Install from source]])"],
  ["(see Releasing)", "(see [[Releasing]])"],
  ["In a terminal in this folder", "In a terminal in a clone of the repository"],
];

// The anchor GitHub gives a heading.
function slug(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
}

// Splits the README into the text before the first `##` (without the title) and
// its `##` sections, each with a body and its `###` subsections.
export function parseReadme(text) {
  const readme = { intro: "", sections: [] };
  let target = null;
  const lines = { intro: [] };
  const flush = () => {
    if (target) target.body = target.lines.join("\n").trim();
  };
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,3}) (.+)$/.exec(line);
    if (!heading) {
      (target ? target.lines : lines.intro).push(line);
      continue;
    }
    if (heading[1] === "#") continue;
    flush();
    target = { name: heading[2].trim(), lines: [], subsections: [] };
    if (heading[1] === "##") readme.sections.push(target);
    else if (readme.sections.length) readme.sections.at(-1).subsections.push(target);
    else throw new Error(`"${line}" comes before any ## section.`);
  }
  flush();
  readme.intro = lines.intro.join("\n").trim();
  return readme;
}

function section(readme, name, sub) {
  const found = readme.sections.find((s) => s.name === name);
  if (!found) throw new Error(`README.md has no "## ${name}" section, which a wiki page is built from.`);
  if (!sub) return found;
  const inner = found.subsections.find((s) => s.name === sub);
  if (!inner) throw new Error(`README.md has no "### ${sub}" under "## ${name}", which a wiki page is built from.`);
  return inner;
}

function afterFirstParagraph(text) {
  const rest = text.split(/\n\s*\n/).slice(1).join("\n\n").trim();
  if (!rest) throw new Error("README.md has nothing after its opening paragraph.");
  return rest;
}

// Points a page's links at the wiki and the repository instead of the README.
function relink(text, page, repoUrl) {
  const pageFor = new Map();
  for (const p of GROUPS.flatMap((g) => g.pages)) for (const a of p.anchors ?? []) pageFor.set(slug(a), p.title);
  for (const [from, to] of MENTIONS) text = text.replaceAll(from, to);
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    if (/^[a-z]+:/i.test(href)) return whole;
    if (href.startsWith("#")) {
      const title = pageFor.get(href.slice(1));
      if (!title) throw new Error(`"${whole}" on the page "${page}" links to a README heading that no wiki page covers.`);
      return label === title ? `[[${title}]]` : `[[${label}|${title}]]`;
    }
    return `[${label}](${repoUrl}/blob/main/${href})`;
  });
}

// Every file of the wiki, as { "Bad-night.md": "...", ... }.
export function buildWiki(readmeText, repoUrl) {
  const readme = parseReadme(readmeText);
  const files = {};
  const home = [HOME_INTRO, ""];
  const sidebar = ["**[[Home]]**"];
  for (const group of GROUPS) {
    home.push(`## ${group.name}`, "");
    sidebar.push("", `**${group.name}**`);
    for (const page of group.pages) {
      files[`${page.title.replace(/ /g, "-")}.md`] = `${relink(page.from(readme), page.title, repoUrl)}\n`;
      home.push(`- [[${page.title}]]: ${page.blurb}`);
      sidebar.push(`- [[${page.title}]]`);
    }
    home.push("");
  }
  home.push(
    `The code, the [changelog](${repoUrl}/blob/main/CHANGELOG.md) and the [issue tracker](${repoUrl}/issues) are in the [repository](${repoUrl}).`,
  );
  files["Home.md"] = `${home.join("\n")}\n`;
  files["_Sidebar.md"] = `${sidebar.join("\n")}\n`;
  return files;
}

function git(args, cwd = ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function die(msg) {
  console.error(`wiki: ${msg}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.find((a) => a !== "--push");
  if (unknown) die(`don't know "${unknown}". The only option is --push.`);
  const dir = mkdtempSync(join(tmpdir(), "nepenthe-wiki-"));
  try {
    const origin = git(["remote", "get-url", "origin"]);
    const repo = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(origin)?.[1];
    if (!repo) die(`the origin remote "${origin}" isn't a GitHub repository.`);
    const files = buildWiki(readFileSync(join(ROOT, "README.md"), "utf8"), `https://github.com/${repo}`);
    git(["clone", "--quiet", origin.replace(/(\.git)?$/, ".wiki.git"), dir]);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const extra = readdirSync(dir).filter((f) => f.endsWith(".md") && !(f in files));
    if (extra.length) console.log(`Not built from the README, left alone: ${extra.join(", ")}\n`);
    git(["add", "--all"], dir);
    const changed = git(["diff", "--cached", "--stat"], dir);
    if (!changed) {
      console.log("The wiki already matches README.md.");
    } else if (!args.includes("--push")) {
      console.log(git(["diff", "--cached"], dir));
      console.log(`\n${changed}\n\nNothing was changed. Run \`npm run wiki -- --push\` to update the wiki.`);
    } else {
      git(["commit", "--quiet", "-m", `Rebuild from README.md at ${git(["rev-parse", "--short", "HEAD"])}`], dir);
      git(["push", "--quiet"], dir);
      console.log(`${changed}\n\nUpdated https://github.com/${repo}/wiki`);
    }
  } catch (e) {
    die(e.stderr?.trim() || e.message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
