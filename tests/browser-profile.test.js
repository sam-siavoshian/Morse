// daemon/browser-profile.js: a browser opened with Morse is signed in to
// everything the everyday one is, and the everyday profile is never written.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { carrySignIns, everydayDir, morseProfileDir, profileCloneCommand } from "../daemon/browser-profile.js";

const { DatabaseSync } = await import("node:sqlite").catch(() => ({}));
const skip = !DatabaseSync && "this Node has no node:sqlite";
const chrome = { id: "chrome", name: "Chrome", browser: true, path: "/Applications/Google Chrome.app" };

// Chrome's cookies table, as it is today (the unique key is Chrome's own).
const COOKIES = `CREATE TABLE cookies (creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
  value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL,
  is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
  priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL,
  last_update_utc INTEGER NOT NULL, source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL);
  CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port);`;
const LOGINS = `CREATE TABLE logins (id INTEGER PRIMARY KEY AUTOINCREMENT, origin_url VARCHAR NOT NULL, username_element VARCHAR, username_value VARCHAR,
  password_element VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));`;

function cookie(db, host, name, value, updated) {
  db.prepare(`INSERT OR REPLACE INTO cookies VALUES (?, ?, '', ?, '', ?, '/', 0, 1, 1, 0, 1, 1, 1, 0, 2, 443, ?, 0, 0)`)
    .run(updated, host, name, Buffer.from(`v10${value}`), updated);
}
const cookiesIn = file => { const db = new DatabaseSync(file); try { return db.prepare("SELECT host_key, name, encrypted_value FROM cookies ORDER BY host_key, name").all().map(r => `${r.host_key} ${r.name}=${Buffer.from(r.encrypted_value).toString().slice(3)}`); } finally { db.close(); } };
const hash = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex");

async function everydayChrome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-bp-"));
  const from = everydayDir(chrome, { platform: "darwin", home });
  await fs.mkdir(path.join(from, "Default", "Network"), { recursive: true });
  await fs.mkdir(path.join(from, "Default", "Cache", "Cache_Data"), { recursive: true });
  await fs.writeFile(path.join(from, "Default", "Cache", "Cache_Data", "f_000001"), "x".repeat(1000));
  await fs.writeFile(path.join(from, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: "same key" } }));
  await fs.writeFile(path.join(from, "Default", "Preferences"), "{}");
  await fs.writeFile(path.join(from, "Default", "Current Session"), "tabs");
  await fs.symlink("Sams-Mac.local-123", path.join(from, "SingletonLock")).catch(() => {});
  const c = new DatabaseSync(path.join(from, "Default", "Network", "Cookies"));
  c.exec(COOKIES);
  cookie(c, ".github.com", "user_session", "gh-1", 100);
  cookie(c, ".spotify.com", "sp_dc", "sp-1", 100);
  c.close();
  const l = new DatabaseSync(path.join(from, "Default", "Login Data"));
  l.exec(LOGINS);
  l.prepare("INSERT INTO logins (origin_url, username_element, username_value, password_element, password_value, signon_realm) VALUES (?, 'u', ?, 'p', ?, ?)")
    .run("https://github.com/login", "sam", Buffer.from("secret"), "https://github.com/");
  l.close();
  return { home, from, morseHome: path.join(home, ".morse") };
}

test("where the profiles are: everyday per browser and system, Morse's own in the Morse folder", () => {
  assert.equal(everydayDir(chrome, { platform: "darwin", home: "/Users/sam" }), "/Users/sam/Library/Application Support/Google/Chrome");
  assert.equal(everydayDir({ ...chrome, path: "/Applications/Chromium.app" }, { platform: "darwin", home: "/Users/sam" }), "/Users/sam/Library/Application Support/Chromium");
  assert.equal(everydayDir(chrome, { platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local" } }), "C:\\Users\\sam\\AppData\\Local\\Google\\Chrome\\User Data");
  assert.equal(everydayDir(chrome, { platform: "linux", env: {}, home: "/home/sam" }), "/home/sam/.config/google-chrome");
  assert.equal(everydayDir({ id: "edge" }, { platform: "darwin", home: "/Users/sam" }), "/Users/sam/Library/Application Support/Microsoft Edge");
  assert.equal(everydayDir({ id: "brave" }, { platform: "linux", env: { XDG_CONFIG_HOME: "/x" }, home: "/home/sam" }), "/x/BraveSoftware/Brave-Browser");
  assert.equal(everydayDir({ id: "arc" }, { platform: "win32", env: {} }), null);
  assert.equal(morseProfileDir(chrome, { platform: "darwin", home: "/Users/sam/.morse" }), "/Users/sam/.morse/browser-profile");
  assert.equal(morseProfileDir({ id: "edge" }, { platform: "darwin", home: "/Users/sam/.morse" }), "/Users/sam/.morse/browser-profile-edge");
});

test("first open: the whole everyday profile comes along (sign-ins, passwords, tabs), caches and locks left out", { skip }, async () => {
  const { home, from, morseHome } = await everydayChrome();
  const before = await hash(path.join(from, "Default", "Network", "Cookies"));
  const said = [];
  assert.deepEqual(await carrySignIns(chrome, { platform: "darwin", home, morseHome, say: s => said.push(s) }), { copied: true });
  assert.match(said[0], /Bringing Chrome's sign-ins, tabs and extensions to Morse \(only this once\)/);
  const to = morseProfileDir(chrome, { platform: "darwin", home: morseHome });
  assert.deepEqual(cookiesIn(path.join(to, "Default", "Network", "Cookies")), [".github.com user_session=gh-1", ".spotify.com sp_dc=sp-1"]);
  assert.equal(JSON.parse(await fs.readFile(path.join(to, "Local State"), "utf8")).os_crypt.encrypted_key, "same key", "the same key, so the cookies read");
  assert.equal(await fs.readFile(path.join(to, "Default", "Current Session"), "utf8"), "tabs");
  assert.equal(await fs.access(path.join(to, "Default", "Login Data")).then(() => true), true);
  await assert.rejects(fs.access(path.join(to, "Default", "Cache")));
  await assert.rejects(fs.lstat(path.join(to, "SingletonLock")));
  await assert.rejects(fs.access(`${to}.copying`));
  assert.equal(await hash(path.join(from, "Default", "Network", "Cookies")), before, "the everyday profile is untouched");
});

test("after: sign-ins made in the everyday browser come in, newer wins, nothing made with Morse is lost, everyday never written", { skip }, async () => {
  const { home, from, morseHome } = await everydayChrome();
  await carrySignIns(chrome, { platform: "darwin", home, morseHome });
  const to = morseProfileDir(chrome, { platform: "darwin", home: morseHome });
  // With Morse: signed in to Figma, and GitHub's session refreshed (newer).
  let db = new DatabaseSync(path.join(to, "Default", "Network", "Cookies"));
  cookie(db, ".figma.com", "auth", "fg-1", 300);
  cookie(db, ".github.com", "user_session", "gh-3", 300);
  db.close();
  // Without Morse: signed in again to Spotify (newer), and to Notion.
  db = new DatabaseSync(path.join(from, "Default", "Network", "Cookies"));
  cookie(db, ".spotify.com", "sp_dc", "sp-2", 200);
  cookie(db, ".notion.so", "token_v2", "no-1", 200);
  cookie(db, ".github.com", "user_session", "gh-2", 200);
  db.close();
  db = new DatabaseSync(path.join(from, "Default", "Login Data"));
  db.prepare("INSERT INTO logins (origin_url, username_element, username_value, password_element, password_value, signon_realm) VALUES (?, 'u', ?, 'p', ?, ?)")
    .run("https://notion.so/login", "sam", Buffer.from("pw"), "https://notion.so/");
  db.close();
  // A second everyday profile (Profile 1) arrived since: it comes in whole.
  await fs.mkdir(path.join(from, "Profile 1"));
  await fs.writeFile(path.join(from, "Profile 1", "Preferences"), "{}");
  const before = await hash(path.join(from, "Default", "Network", "Cookies"));
  const r = await carrySignIns(chrome, { platform: "darwin", home, morseHome });
  assert.ok(r.merged >= 4, JSON.stringify(r));
  assert.deepEqual(cookiesIn(path.join(to, "Default", "Network", "Cookies")),
    [".figma.com auth=fg-1", ".github.com user_session=gh-3", ".notion.so token_v2=no-1", ".spotify.com sp_dc=sp-2"]);
  db = new DatabaseSync(path.join(to, "Default", "Login Data"));
  assert.deepEqual(db.prepare("SELECT origin_url FROM logins ORDER BY origin_url").all().map(r => r.origin_url), ["https://github.com/login", "https://notion.so/login"]);
  db.close();
  assert.equal(await fs.readFile(path.join(to, "Profile 1", "Preferences"), "utf8"), "{}");
  assert.equal(await hash(path.join(from, "Default", "Network", "Cookies")), before, "the everyday profile is untouched");
  // Again, with nothing new: nothing changes.
  assert.deepEqual(await carrySignIns(chrome, { platform: "darwin", home, morseHome }), { merged: 0 });
});

test("no everyday profile (a browser never used): nothing to bring, Morse's profile starts fresh", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-bp-"));
  assert.deepEqual(await carrySignIns(chrome, { platform: "darwin", home, morseHome: path.join(home, ".morse") }), {});
  assert.deepEqual(await carrySignIns({ id: "arc", name: "Arc" }, { platform: "win32", env: {}, home, morseHome: path.join(home, ".morse") }), {});
});

test("a Mac clone is one directory clone; a normal disk is not asked to pretend a slow copy was a clone", () => {
  assert.deepEqual(profileCloneCommand("darwin", "/src/Chrome", "/dst/browser-profile"), { file: "/bin/cp", args: ["-cRp", "/src/Chrome", "/dst/browser-profile"] });
  assert.deepEqual(profileCloneCommand("linux", "/src/Chrome", "/dst/browser-profile"), { file: "cp", args: ["-a", "--reflink=always", "/src/Chrome", "/dst/browser-profile"] });
  assert.equal(profileCloneCommand("win32", "C:\\src", "C:\\dst"), null);
});

// The first open used to copy every file on its own. A real Chrome profile is
// tens of thousands of files, and that copy took about a minute even when each
// file was a clone. Caches are left unread; heavy folders are one clone each.
test("first open clones each heavy folder once and does not read the caches", { skip }, async () => {
  const { home, from, morseHome } = await everydayChrome();
  const idb = path.join(from, "Default", "IndexedDB", "https_github.com_0.indexeddb.leveldb");
  await fs.mkdir(idb, { recursive: true });
  await Promise.all(Array.from({ length: 40 }, (_, i) => fs.writeFile(path.join(idb, `f${i}`), "x".repeat(32))));
  await fs.mkdir(path.join(from, "Default", "Extensions", "ext", "1.0"), { recursive: true });
  await fs.writeFile(path.join(from, "Default", "Extensions", "ext", "1.0", "manifest.json"), "{}");
  const swDb = path.join(from, "Default", "Service Worker", "Database");
  await fs.mkdir(swDb, { recursive: true });
  await fs.writeFile(path.join(swDb, "CURRENT"), "ok");
  const swCache = path.join(from, "Default", "Service Worker", "CacheStorage");
  await fs.mkdir(swCache, { recursive: true });
  await fs.writeFile(path.join(swCache, "blob"), "nope");
  const storageCache = path.join(from, "Default", "Storage", "ext", "abc", "def", "CacheStorage");
  await fs.mkdir(storageCache, { recursive: true });
  await fs.writeFile(path.join(storageCache, "blob"), "nope");
  const storageKeep = path.join(from, "Default", "Storage", "ext", "abc", "def", "Local Storage", "leveldb");
  await fs.mkdir(storageKeep, { recursive: true });
  await fs.writeFile(path.join(storageKeep, "CURRENT"), "keep");
  // Opening either cache is the minute-long part. The copy must not do it.
  await fs.chmod(path.join(from, "Default", "Cache"), 0);
  await fs.chmod(swCache, 0);
  await fs.chmod(storageCache, 0);
  const calls = [];
  const cloneDir = async (src, dst) => {
    calls.push(path.relative(from, src));
    await fs.cp(src, dst, { recursive: true, verbatimSymlinks: true });
    return true;
  };
  try {
    assert.deepEqual(await carrySignIns(chrome, { platform: "darwin", home, morseHome, cloneDir }), { copied: true });
  } finally {
    await fs.chmod(path.join(from, "Default", "Cache"), 0o755).catch(() => {});
    await fs.chmod(swCache, 0o755).catch(() => {});
    await fs.chmod(storageCache, 0o755).catch(() => {});
  }
  assert.equal(calls.filter(c => c === "Default/IndexedDB").length, 1, calls.join("\n"));
  assert.equal(calls.filter(c => c.startsWith("Default/IndexedDB/")).length, 0);
  assert.equal(calls.filter(c => c === "Default/Extensions").length, 1);
  assert.ok(!calls.includes("") && !calls.includes("Default") && !calls.includes("Default/Storage"), calls.join("\n"));
  assert.ok(calls.every(c => !/(^|\/)(Cache|Code Cache|CacheStorage|GPUCache)(\/|$)/.test(c)), calls.join("\n"));
  const to = morseProfileDir(chrome, { platform: "darwin", home: morseHome });
  assert.equal((await fs.readdir(path.join(to, "Default", "IndexedDB", "https_github.com_0.indexeddb.leveldb"))).length, 40);
  assert.equal(await fs.readFile(path.join(to, "Default", "Extensions", "ext", "1.0", "manifest.json"), "utf8"), "{}");
  assert.equal(await fs.readFile(path.join(to, "Default", "Service Worker", "Database", "CURRENT"), "utf8"), "ok");
  assert.equal(await fs.readFile(path.join(to, "Default", "Storage", "ext", "abc", "def", "Local Storage", "leveldb", "CURRENT"), "utf8"), "keep");
  assert.equal(await fs.readFile(path.join(to, "Default", "Current Session"), "utf8"), "tabs");
  await assert.rejects(fs.access(path.join(to, "Default", "Cache")));
  await assert.rejects(fs.access(path.join(to, "Default", "Service Worker", "CacheStorage")));
  await assert.rejects(fs.access(path.join(to, "Default", "Storage", "ext", "abc", "def", "CacheStorage")));
  await assert.rejects(fs.lstat(path.join(to, "SingletonLock")));
});

test("when the disk cannot clone, the same profile is still copied and the caches stay out", { skip }, async () => {
  const { home, from, morseHome } = await everydayChrome();
  const idb = path.join(from, "Default", "IndexedDB", "origin");
  await fs.mkdir(idb, { recursive: true });
  await Promise.all(Array.from({ length: 8 }, (_, i) => fs.writeFile(path.join(idb, `f${i}`), "y")));
  let tries = 0;
  const cloneDir = async (src, dst) => {
    tries++;
    await fs.mkdir(dst, { recursive: true });
    await fs.writeFile(path.join(dst, "partial"), "x");
    return false;
  };
  assert.deepEqual(await carrySignIns(chrome, { platform: "darwin", home, morseHome, cloneDir }), { copied: true });
  assert.ok(tries >= 1);
  const to = morseProfileDir(chrome, { platform: "darwin", home: morseHome });
  assert.equal((await fs.readdir(path.join(to, "Default", "IndexedDB", "origin"))).length, 8);
  await assert.rejects(fs.access(path.join(to, "Default", "IndexedDB", "origin", "partial")));
  await assert.rejects(fs.access(path.join(to, "Default", "Cache")));
  assert.deepEqual(cookiesIn(path.join(to, "Default", "Network", "Cookies")), [".github.com user_session=gh-1", ".spotify.com sp_dc=sp-1"]);
  await assert.rejects(fs.access(`${to}.copying`));
});

test("an everyday Chrome counts as Chrome being open (Morse quits it before opening its copy); another profile doesn't", async () => {
  const { findAppProcesses, launchArgs } = await import("../daemon/apps.js");
  const app = { ...chrome, path: "/usr/bin/google-chrome" };
  const mine = morseProfileDir(app, { platform: "linux" });
  const procs = [
    { pid: 10, ppid: 1, cmd: "/usr/bin/google-chrome" },
    { pid: 11, ppid: 10, cmd: "/usr/bin/google-chrome --type=renderer" },
    { pid: 20, ppid: 1, cmd: `/usr/bin/google-chrome --remote-debugging-pipe --user-data-dir=${mine}` },
    { pid: 30, ppid: 1, cmd: "/usr/bin/google-chrome --user-data-dir=/tmp/someone-elses-test" },
    { pid: 40, ppid: 1, cmd: `/usr/bin/google-chrome --user-data-dir=${everydayDir(app, { platform: "linux" })}` },
  ];
  assert.deepEqual(findAppProcesses(app, procs, { platform: "linux" }).map(p => p.pid), [10, 20, 40]);
  assert.deepEqual(findAppProcesses(app, procs, { platform: "linux", extraArgs: ["--user-data-dir=/tmp/someone-elses-test"] }).map(p => p.pid), [30]);
  assert.ok(launchArgs(app, "pipe", [], { platform: "linux" }).includes(`--user-data-dir=${mine}`));
});
