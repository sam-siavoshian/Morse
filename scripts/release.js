// Make a release, on this computer, ready to push:
//
//   npm run release -- patch|minor|major|x.y.z [--dry-run]
//
//   1. checks: a clean working tree on a branch, a new version, no tag for it
//      yet, and something under "## Unreleased" in CHANGELOG.md
//   2. writes the version into package.json and package-lock.json (the build
//      copies it into the extension's manifest)
//   3. moves CHANGELOG.md's "Unreleased" section under "## x.y.z (date)" and
//      leaves an empty "Unreleased" on top
//   4. runs `npm run check` and `npm test` (puts the files back if they fail)
//   5. commits "Release vx.y.z" and makes the annotated tag vx.y.z
//
// It never pushes. It prints the push command; pushing the tag starts
// .github/workflows/release.yml. --dry-run says what would happen and
// changes nothing. --skip-checks leaves out step 4 (for tests of this script).
//
//   node scripts/release.js notes [x.y.z]   prints that version's CHANGELOG
//                                           section (the release workflow uses it)
//
// docs/dev/releasing.md is the whole process.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v).trim().replace(/^v/, ""));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || "" };
}

// -1, 0 or 1. A pre-release (1.0.0-beta.1) comes before its release (1.0.0).
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, "en", { numeric: true }) < 0 ? -1 : 1;
}

export function nextVersion(current, how) {
  const c = parseVersion(current);
  if (!c) throw new Error(`package.json has a version npm can't use: ${current}`);
  if (how === "major") return `${c.major + 1}.0.0`;
  if (how === "minor") return `${c.major}.${c.minor + 1}.0`;
  if (how === "patch") return c.pre ? `${c.major}.${c.minor}.${c.patch}` : `${c.major}.${c.minor}.${c.patch + 1}`;
  const v = parseVersion(how);
  if (!v) throw new Error(`Say patch, minor, major or a version like 1.2.3 (got “${how ?? ""}”).`);
  return String(how).trim().replace(/^v/, "");
}

const HEADING = /^## +(.+?)\s*$/gm;
const sections = text => {
  const heads = [...text.matchAll(HEADING)];
  return heads.map((h, i) => ({ title: h[1], start: h.index, bodyStart: h.index + h[0].length, end: i + 1 < heads.length ? heads[i + 1].index : text.length }));
};
const versionOf = title => /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(title)?.[1] || null;

export const hasSection = (text, version) => sections(text).some(s => versionOf(s.title) === version);

// CHANGELOG.md with "## Unreleased" turned into "## <version> (<date>)" and a
// new, empty "## Unreleased" above it.
export function cutChangelog(text, version, date) {
  const all = sections(text);
  const un = all.find(s => /^unreleased$/i.test(s.title));
  if (!un) throw new Error("CHANGELOG.md has no “## Unreleased” section. Add one with what changed.");
  if (hasSection(text, version)) throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  const body = text.slice(un.bodyStart, un.end).trim();
  if (!body) throw new Error("“## Unreleased” in CHANGELOG.md is empty. Write down what changed first.");
  return `${text.slice(0, un.start)}## Unreleased\n\n## ${version} (${date})\n\n${body}\n\n${text.slice(un.end).replace(/^\n+/, "")}`.replace(/\n*$/, "\n");
}

// The text under "## <version>", for the GitHub release. With `base`, links
// to files in the repo become absolute (a release page can't follow
// "docs/privacy.md").
export function notesFor(text, version, { base } = {}) {
  const s = sections(text).find(s => versionOf(s.title) === version);
  if (!s) return null;
  const body = text.slice(s.bodyStart, s.end).trim() + "\n";
  return base ? body.replace(/(\]\()(?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi, (m, open, target) => `${open}${base}${target.replace(/^\.\//, "")})`) : body;
}

// https://github.com/<owner>/<repo>/blob/<ref>/ from package.json's repository.
export function blobBase(pkg, ref) {
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "";
  const m = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/.exec(url);
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/${ref}/` : undefined;
}

// package.json's version line only, so the rest of the file stays as it is.
export function withVersion(pkgText, version) {
  const out = pkgText.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (out === pkgText && JSON.parse(pkgText).version !== version) throw new Error("package.json has no version line.");
  return out;
}

export function lockWithVersion(lockText, version) {
  const lock = JSON.parse(lockText);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return JSON.stringify(lock, null, 2) + "\n";
}

// ---- the command

function main(argv, { root = process.cwd(), log = console.log, today = new Date() } = {}) {
  const args = argv.filter(a => !a.startsWith("--"));
  const opts = new Set(argv.filter(a => a.startsWith("--")));
  for (const o of opts) if (!["--dry-run", "--skip-checks"].includes(o)) throw new Error(`Unknown option ${o}. Use --dry-run to see what would happen.`);
  const file = f => path.join(root, f);
  const read = f => readFileSync(file(f), "utf8");
  const pkg = JSON.parse(read("package.json"));

  if (args[0] === "notes") {
    const v = args[1] || pkg.version;
    const notes = notesFor(read("CHANGELOG.md"), v, { base: blobBase(pkg, `v${v}`) });
    if (!notes) throw new Error(`CHANGELOG.md has no section for ${v}.`);
    process.stdout.write(notes);
    return;
  }

  // `npm run release minor --dry-run` (no `--`): npm keeps the flag for itself
  // and only sets npm_config_dry_run. Still a dry run.
  const dry = opts.has("--dry-run") || process.env.npm_config_dry_run === "true";
  if (!args[0]) throw new Error("Which release? npm run release -- patch, minor, major or a version like 1.2.3 (add --dry-run to try it first).");
  const version = nextVersion(pkg.version, args[0]);
  const tag = `v${version}`;
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  const changelog = read("CHANGELOG.md");

  // A version that is the current one is fine once: the first release of a
  // version package.json already has (0.2.0 here).
  const cmp = compareVersions(version, pkg.version);
  if (cmp < 0 || (cmp === 0 && hasSection(changelog, version))) throw new Error(`${version} isn't newer than ${pkg.version}, the version in package.json.`);
  if (git("rev-parse", "-q", "--verify", `refs/tags/${tag}`).status === 0) throw new Error(`The tag ${tag} already exists.`);
  const branch = git("symbolic-ref", "--short", "-q", "HEAD").stdout.trim();
  if (!branch) throw new Error("Not on a branch. Switch to main first: git switch main");
  const dirty = git("status", "--porcelain").stdout.trimEnd();
  const problems = [];
  if (dirty) problems.push(`There are changes that aren't committed:\n${dirty.split("\n").map(l => "    " + l).join("\n")}\n  Commit or put them aside first.`);
  const date = today.toISOString().slice(0, 10);
  const newChangelog = cutChangelog(changelog, version, date); // throws when Unreleased is missing or empty
  if (problems.length && !dry) throw new Error(problems.join("\n"));

  const remote = git("remote").stdout.split("\n").map(s => s.trim()).filter(Boolean);
  const push = `git push --follow-tags ${remote.includes("origin") ? "origin" : remote[0] || "origin"} ${branch}`;
  const changed = ["package.json", "CHANGELOG.md", ...(existsSync(file("package-lock.json")) ? ["package-lock.json"] : [])];

  if (dry) {
    log(`Dry run: nothing is changed.

Release     ${tag} (now ${pkg.version})
Branch      ${branch}${branch === "main" ? "" : "   (releases normally come from main)"}
Would write ${changed.join(", ")}
Would run   npm run check, npm test${opts.has("--skip-checks") ? " (skipped: --skip-checks)" : ""}
Would make  the commit “Release ${tag}” and the tag ${tag}
Then push   ${push}
${problems.length ? `\nFix this first:\n  ${problems.join("\n  ")}\n` : ""}
CHANGELOG.md, the new section:

## ${version} (${date})

${notesFor(newChangelog, version)}`);
    return;
  }

  const before = Object.fromEntries(changed.map(f => [f, read(f)]));
  const restore = () => { for (const [f, text] of Object.entries(before)) writeFileSync(file(f), text); };
  writeFileSync(file("package.json"), withVersion(before["package.json"], version));
  if (before["package-lock.json"]) writeFileSync(file("package-lock.json"), lockWithVersion(before["package-lock.json"], version));
  writeFileSync(file("CHANGELOG.md"), newChangelog);
  log(`${tag}: wrote ${changed.join(", ")}.`);

  if (!opts.has("--skip-checks")) {
    for (const script of ["check", "test"]) {
      log(`\nnpm run ${script}`);
      const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
      if (r.status !== 0) {
        restore();
        throw new Error(`npm run ${script} failed, so nothing was released. ${changed.join(", ")} are back as they were.`);
      }
    }
    // The build writes dist/ only (git ignores it). Anything else the checks
    // changed stays out of the release commit; say so.
    const after = git("status", "--porcelain").stdout.split("\n").filter(Boolean).map(l => l.slice(3)).filter(f => !changed.includes(f));
    if (after.length) log(`\nThe checks also changed ${after.join(", ")}. They are not part of the release commit.`);
  }

  const add = git("add", "--", ...changed);
  const commit = add.status === 0 && git("commit", "-q", "-m", `Release ${tag}`, "--", ...changed);
  if (!commit || commit.status !== 0) { restore(); throw new Error(`git commit failed: ${(commit || add).stderr.trim()}`); }
  const tagged = git("tag", "-a", tag, "-m", `Morse ${version}`);
  if (tagged.status !== 0) throw new Error(`The commit is made, but git tag failed: ${tagged.stderr.trim()}\n  Make it with: git tag -a ${tag} -m "Morse ${version}"`);

  log(`
Made the commit “Release ${tag}” and the tag ${tag}. Nothing is pushed yet.

To publish it, push both:

  ${push}

The tag starts the release workflow: checks, tests, npm, the GitHub release
with the Chrome Web Store zip. Then upload the zip by hand
(docs/store/SUBMIT.md).

Changed your mind? git tag -d ${tag} && git reset --hard HEAD~1`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2), { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
