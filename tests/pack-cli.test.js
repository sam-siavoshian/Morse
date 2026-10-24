// `morse pack make | install | list | unsubscribe`, run as the real command in
// a scratch MORSE_HOME: the same plain-words summary as `morse install`, a
// confirm prompt (or --yes), clashes with your own mods never overwritten
// without asking, packs from an address (https, or this computer), and
// hostile files refused with a plain message.
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";

const CLI = new URL("../daemon/cli.js", import.meta.url).pathname;
const strip = s => s.replace(/\x1b\[\d+m/g, "");
function morse(args, homeDir) {
  return new Promise(resolve => execFile(process.execPath, [CLI, ...args], {
    env: { ...process.env, MORSE_HOME: homeDir, MORSE_HELPER_PORT: "1" }, timeout: 60000,
  }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, out: strip(stdout), err: strip(stderr) })));
}
const mod = (id, extra = {}) => ({ morse: 1, id, title: `Mod ${id}`, prompt: `make ${id}`, css: `.${id} { color: red; }`, js: "", enabled: true, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", match: { hosts: ["team.example"], app: null }, ...extra });
async function homeWith(mods = []) {
  const h = tempDir("morse-pack-cli-");
  await fs.mkdir(path.join(h, "mods"), { recursive: true });
  for (const m of mods) await fs.writeFile(path.join(h, "mods", `${m.id}.json`), JSON.stringify(m, null, 2));
  return h;
}
const readMods = async h => Object.fromEntries(await Promise.all((await fs.readdir(path.join(h, "mods"))).filter(f => f.endsWith(".json")).map(async f => [f.slice(0, -5), JSON.parse(await fs.readFile(path.join(h, "mods", f), "utf8"))])));

const servers = [];
after(() => servers.forEach(s => s.close()));

let made, file, link;
test("morse pack make: a pack file and a share link from your mods", async () => {
  made = await homeWith([mod("aa"), mod("bb", { js: "morse.on(document, 'keydown', e => console.log(e.key));" }), mod("cc")]);
  file = path.join(made, "team.morse-pack.json");
  const r = await morse(["pack", "make", "aa", "bb", "--name", "Team tools", "--note", "For the board team", "--out", file], made);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Made the pack Team tools with 2 mods/);
  assert.match(r.out, /Mod aa aa\n {2}Mod bb bb/);
  link = r.out.match(/Share link: (\S+)/)[1];
  assert.match(link, /install\.html#m=/);
  const pack = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(pack.morse, "morse-pack");
  assert.equal(pack.note, "For the board team");
  assert.deepEqual(pack.mods.map(m => m.id), ["aa", "bb"]);
  assert.ok(pack.mods.every(m => m.enabled === undefined));

  const noName = await morse(["pack", "make", "aa"], made);
  assert.equal(noName.code, 1);
  assert.match(noName.err, /Give the pack a name with --name/);
  const missing = await morse(["pack", "make", "zz", "--name", "x"], made);
  assert.match(missing.err, /There's no mod called zz/);
});

test("morse pack install: says what each mod does, and asks first", async () => {
  const friend = await homeWith();
  const r = await morse(["pack", "install", file], friend);
  assert.equal(r.code, 1, "no terminal to ask in, and no --yes");
  assert.match(r.out, /The pack Team tools has 2 mods\./);
  assert.match(r.out, /“For the board team”/);
  assert.match(r.out, /Mod aa for team\.example\n {2}“make aa”\n {2}- Changes how the page looks/);
  assert.match(r.out, /Mod bb[\s\S]*Reads what you type on this page[\s\S]*Note: This mod can read what you type/);
  assert.match(r.err, /Add --yes to install without being asked/);
  assert.deepEqual(await readMods(friend), {}, "nothing installed before saying yes");

  const ok = await morse(["pack", "install", file, "--yes"], friend);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Installed 2 mods from Team tools: Mod aa, Mod bb/);
  const mods = await readMods(friend);
  assert.deepEqual(Object.keys(mods).sort(), ["aa", "bb"]);
  assert.equal(mods.aa.pack.name, "Team tools");
  assert.equal(mods.aa.importedFrom, "pack");

  // From the link, too: the same pack, so it's an update of the copies installed.
  const again = await morse(["pack", "install", link, "--yes"], friend);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Replaces your copy from this pack/);
  assert.deepEqual(Object.keys(await readMods(friend)).sort(), ["aa", "bb"]);

  const list = await morse(["pack", "list"], friend);
  assert.match(list.out, /● Team tools team-tools-\w{4} {2}2 mods/);
});

test("morse pack install: an id that clashes with your own mod is never overwritten without asking", async () => {
  // Installing into the home the pack was made in: aa and bb are your own mods there.
  const r = await morse(["pack", "install", file, "--yes"], made);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /You already have this mod: “Mod aa”/);
  let mods = await readMods(made);
  assert.deepEqual(Object.keys(mods).sort(), ["aa", "aa-2", "bb", "bb-2", "cc"], "--yes keeps both");
  assert.equal(mods.aa.pack, undefined, "yours is untouched");
  // Again: the copies from this pack are updated; yours still aren't touched.
  const again = await morse(["pack", "install", file, "--yes", "--replace"], made);
  assert.equal(again.code, 0, again.err);
  mods = await readMods(made);
  assert.deepEqual(Object.keys(mods).sort(), ["aa", "aa-2", "bb", "bb-2", "cc"]);
  assert.equal(mods.aa.pack, undefined);
  // --replace: yours is replaced, because you said so.
  const mine = await homeWith([mod("aa", { title: "Mine" })]);
  const replace = await morse(["pack", "install", file, "--yes", "--replace"], mine);
  assert.equal(replace.code, 0, replace.err);
  mods = await readMods(mine);
  assert.deepEqual(Object.keys(mods).sort(), ["aa", "bb"]);
  assert.equal(mods.aa.title, "Mod aa");
  assert.ok(mods.aa.pack);
});

test("morse pack install: from an address, with --subscribe; list and unsubscribe", async () => {
  const body = JSON.stringify({ morse: "morse-pack", version: 1, id: "board", name: "Board", mods: [mod("dd")] });
  const s = http.createServer((q, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(body)).listen(0, "127.0.0.1");
  servers.push(s);
  await new Promise(r => s.on("listening", r));
  const addr = `http://127.0.0.1:${s.address().port}/board.json`;
  const h = await homeWith();
  const r = await morse(["pack", "install", addr, "--yes", "--subscribe"], h);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Installed 1 mod from Board/);
  assert.match(r.out, new RegExp(`Morse checks ${addr.replace(/[.]/g, "\\.")} for updates at most once a day`));
  const list = await morse(["pack", "list"], h);
  assert.match(list.out, /Board board {2}1 mod/);
  assert.match(list.out, /updates from http:\/\/127\.0\.0\.1:\d+\/board\.json · checked just now/);
  const un = await morse(["pack", "unsubscribe", "board"], h);
  assert.match(un.out, /Stopped updates from Board\. Its mods stay installed/);
  assert.doesNotMatch((await morse(["pack", "list"], h)).out, /updates from/);
  assert.ok((await readMods(h)).dd);

  // Without --subscribe, it says how; an http address elsewhere is refused.
  const h2 = await homeWith();
  const plain = await morse(["pack", "install", addr, "--yes"], h2);
  assert.match(plain.out, /To get updates from this address: morse pack install .* --subscribe/);
  const insecure = await morse(["pack", "install", "http://team.example/board.json", "--yes"], h2);
  assert.equal(insecure.code, 1);
  assert.match(insecure.err, /has to come from an https:\/\/ address/);
});

test("morse pack install: hostile files are refused with a plain message", async () => {
  const h = await homeWith();
  const huge = path.join(h, "huge.json");
  await fs.writeFile(huge, JSON.stringify({ morse: "morse-pack", name: "x", mods: [mod("a", { css: "x".repeat(2_100_000) })] }));
  assert.match((await morse(["pack", "install", huge, "--yes"], h)).err, /too big/);
  const bad = path.join(h, "bad.json");
  await fs.writeFile(bad, "{ nope");
  assert.match((await morse(["pack", "install", bad, "--yes"], h)).err, /isn't a Morse share link or mod file/);
  const many = path.join(h, "many.json");
  await fs.writeFile(many, JSON.stringify({ morse: "morse-pack", name: "x", mods: Array.from({ length: 80 }, (_, i) => mod(`m${i}`)) }));
  assert.match((await morse(["pack", "install", many, "--yes"], h)).err, /80 mods\. Morse installs up to 50/);
  const one = path.join(h, "one.json");
  await fs.writeFile(one, JSON.stringify(mod("solo")));
  assert.match((await morse(["pack", "install", one, "--yes"], h)).err, /This is a mod, not a pack/);
  const dup = path.join(h, "dup.json");
  await fs.writeFile(dup, JSON.stringify({ morse: "morse-pack", name: "<script>x</script>", mods: [mod("a"), mod("a", { title: "again" })] }));
  const d = await morse(["pack", "install", dup, "--yes"], h);
  assert.equal(d.code, 0, d.err);
  assert.match(d.out, /Skipped Mod 2: It has the same id as another mod in this pack \(a\)/);
  assert.deepEqual(Object.keys(await readMods(h)), ["a"]);
  assert.match((await morse(["pack", "nonsense"], h)).err, /There's no morse pack nonsense/);
});

test("morse pack install asks in a terminal: install? replace yours? get updates?", async () => {
  // In this process (MORSE_HOME is helpers/home.js's), with the questions answered here.
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  await fs.writeFile(path.join(home, "mods", "aa.json"), JSON.stringify(mod("aa", { title: "Mine" })));
  const { packCli } = await import("../daemon/packs.js");
  const asked = [];
  const answers = a => q => (asked.push(q), a.shift() || "");
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await packCli({ _: ["install", file] }, { ask: answers(["n"]) }), null, "no: nothing installed");
    assert.match(asked[0], /Install all 2\? \[y\/N\]/);
    asked.length = 0;
    const r = await packCli({ _: ["install", file] }, { ask: answers(["y", "y"]) });
    assert.match(asked[1], /Replace your “Mine” with the pack's “Mod aa”\? No keeps both\. \[y\/N\]/);
    assert.deepEqual(r.saved.map(m => m.id).sort(), ["aa", "bb"]);
  } finally { console.log = log; }
  assert.equal(JSON.parse(await fs.readFile(path.join(home, "mods", "aa.json"), "utf8")).title, "Mod aa", "replaced, because you said yes");
});
