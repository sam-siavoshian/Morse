// What real, installed apps turned up (VSCodium 1.140 from its .deb, Obsidian
// 1.14 and Joplin 3.7 as AppImages, with Claude Code haiku; docs/desktop.md
// "Tested on"), each pinned down without the apps themselves:
//   - VS Code's window enforces Trusted Types: HTML strings throw, so the
//     runtime's bar never started. Morse's own world now builds its UI node
//     by node there, and the page's protection stays on.
//   - A .deb in /usr/share and AppImages weren't found by `morse apps`.
//   - Old AppImages quit at once without FUSE; Morse runs them unpacked.
//   - Joplin quits on switches it doesn't know (--remote-allow-origins).
//   - An AppImage's file:// UI moves every launch, so saved mods didn't come back.
//   - The Mods panel said "on this site" in a desktop app.
import { tempDir } from "./helpers/home.js"; // first: a MORSE_HOME of its own, and temp folders removed at exit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

const home = tempDir("morse-real-apps-");
process.env.MORSE_HOME = home;
const apps = await import("../daemon/apps.js");
const { inspectFuses, formatFuses } = await import("../daemon/fuses.js");
const { safeExtraArgs } = await import("../daemon/ports.js");
const { modMatches } = await import("../core/mod.js");

const put = async (file, data = "") => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); };
const ELF = "\x7fELF\x02\x01\x01\x00";
const APPIMAGE = Buffer.concat([Buffer.from(ELF), Buffer.from("AI\x02"), Buffer.alloc(64)]);

// ---------------------------------------------------------------- finding them

test("morse apps finds a .deb in /usr/share (named from VS Code's product.json) and AppImages wherever they are", async () => {
  const r = tempDir("morse-linux-");
  // VSCodium's .deb: the app in /usr/share/codium, a menu entry, and a shell script on PATH.
  await put(path.join(r, "usr/share/codium/codium"), ELF);
  await put(path.join(r, "usr/share/codium/resources/app/package.json"), JSON.stringify({ name: "VSCodium", desktopName: "codium.desktop", version: "1.140.06880" }));
  await put(path.join(r, "usr/share/codium/resources/app/product.json"), JSON.stringify({ nameLong: "VSCodium", applicationName: "codium" }));
  await put(path.join(r, "usr/share/applications/codium.desktop"), "[Desktop Entry]\nName=VSCodium\nExec=/usr/share/codium/codium %F\nType=Application\n");
  // An Electron app the catalog doesn't know, installed by a .deb in /usr/lib, launched through env.
  await put(path.join(r, "usr/lib/acme-notes/acme-notes"), ELF);
  await put(path.join(r, "usr/lib/acme-notes/resources/app.asar"), "x");
  await put(path.join(r, "usr/share/applications/acme.desktop"), "[Desktop Entry]\nName=Acme Notes\nName[de]=Acme Notizen\nExec=env ACME_X=1 \"/usr/lib/acme-notes/acme-notes\" %U\n\n[Desktop Action new]\nName=New\nExec=/bin/false\n");
  // A native app in the menu: not listed.
  await put(path.join(r, "usr/bin/gedit"), ELF);
  await put(path.join(r, "usr/share/applications/gedit.desktop"), "[Desktop Entry]\nName=Text Editor\nExec=gedit %U\n");
  // AppImages: one downloaded to ~/Applications, one an installer put in ~/.joplin with a menu entry, one unknown.
  await put(path.join(r, "home/sam/Applications/Obsidian-1.14.5.AppImage"), APPIMAGE);
  await put(path.join(r, "home/sam/.joplin/Joplin.AppImage"), APPIMAGE);
  await put(path.join(r, "home/sam/.local/share/applications/appimagekit-joplin.desktop"), "[Desktop Entry]\nName=Joplin\nExec=/home/sam/.joplin/Joplin.AppImage %u\nType=Application\n");
  await put(path.join(r, "home/sam/Downloads/Foo_Chat-2.0.1-x86_64.AppImage"), APPIMAGE);

  const ctx = apps.hostContext({ platform: "linux", root: r, home: "/home/sam", env: { PATH: "/usr/bin" } });
  const found = Object.fromEntries(apps.discoverApps(ctx).map(a => [a.id, a]));
  assert.equal(found.vscodium?.name, "VSCodium");
  assert.equal(found.vscodium.version, "1.140.06880");
  assert.equal(found.vscodium.canAttach, true);
  assert.equal(apps.appFromPath(ctx, "/usr/share/codium/codium").name, "VSCodium", "product.json, not \"codium.desktop\"");
  assert.equal(found["acme-notes"]?.name, "Acme Notes", "named as the menu names it");
  assert.equal(found["acme-notes"].exe, "/usr/lib/acme-notes/acme-notes");
  assert.equal(found["acme-notes"].engine, "electron");
  assert.ok(!Object.values(found).some(a => /Text Editor|gedit/.test(a.name)), "native apps stay out");
  assert.equal(found.obsidian?.path, "/home/sam/Applications/Obsidian-1.14.5.AppImage");
  assert.equal(found.obsidian.appimage, true);
  assert.equal(found.obsidian.why, "Electron app", "the catalog knows Obsidian is Electron");
  assert.equal(found.joplin?.path, "/home/sam/.joplin/Joplin.AppImage", "found through its menu entry");
  assert.equal(found["foo-chat"]?.name, "Foo_Chat");
  assert.equal(found["foo-chat"].canAttach, null);
  assert.equal(found["foo-chat"].why, "AppImage, couldn't look inside");
  // By name and by path.
  assert.equal(apps.resolveApp("codium", { ctx }).id, "vscodium");
  const byPath = apps.resolveApp("/home/sam/Applications/Obsidian-1.14.5.AppImage", { ctx });
  assert.equal(byPath.name, "Obsidian");
  assert.equal(byPath.appimage, true);
});

test(".desktop parsing: only [Desktop Entry], and the program behind env, quotes and %U", () => {
  assert.deepEqual(apps.parseDesktopEntry("[Desktop Entry]\nName=A\nName[fr]=B\nExec=a %U\n[Desktop Action x]\nExec=b\n"), { Name: "A", Exec: "a %U" });
  assert.equal(apps.execProgram(`env -u X FOO=1 "/opt/My App/app" --x %U`), "/opt/My App/app");
  assert.equal(apps.execProgram("obsidian %u"), "obsidian");
  assert.equal(apps.execProgram("%U"), null);
  assert.equal(apps.appImageName("Logseq-linux-x64-0.10.9.AppImage"), "Logseq");
  assert.equal(apps.appImageName("/x/Joplin.AppImage"), "Joplin");
});

test("an AppImage without FUSE is run unpacked, and morse fuses says why it can't read its fuses", async () => {
  const app = { id: "obsidian", appimage: true };
  const none = () => false;
  assert.equal(apps.appImageEnv(app, { env: { HOME: "/h" }, has: none }).APPIMAGE_EXTRACT_AND_RUN, "1", "Ubuntu 24.04 ships no libfuse2");
  assert.equal(apps.appImageEnv(app, { env: {}, has: () => true }), null, "with FUSE it mounts as usual");
  assert.equal(apps.appImageEnv({ id: "x" }, { env: {}, has: none }), null, "only AppImages");
  const r = tempDir("morse-ai-");
  await put(path.join(r, "Joplin.AppImage"), APPIMAGE);
  const info = await inspectFuses(path.join(r, "Joplin.AppImage"));
  assert.equal(info.appimage, true);
  assert.match(formatFuses(info, "Joplin"), /It's an AppImage: the app is packed inside it/);
  assert.doesNotMatch(formatFuses(info, "Joplin"), /native app/);
});

test("the app gets only the debugging port: no --remote-allow-origins (Joplin quits on it), and none from the command line", () => {
  assert.deepEqual(apps.launchArgs({ id: "joplin" }, 9333, ["--no-sandbox", "--remote-allow-origins=*"]), ["--remote-debugging-port=9333", "--no-sandbox"]);
  assert.deepEqual(safeExtraArgs(["--remote-allow-origins=https://evil.example", "--x"]), ["--x"]);
});

test("in an app, a file:// UI is matched by its path inside the app: an AppImage mounts somewhere new every launch", () => {
  const mod = { match: { app: "joplin", hosts: ["file:///tmp/.mount_JoplinAbC123/resources/app.asar/index.html"] } };
  assert.ok(modMatches(mod, { app: "joplin", url: "file:///tmp/.mount_JoplinXyZ789/resources/app.asar/index.html" }));
  assert.ok(modMatches(mod, { app: "joplin", url: "file:///tmp/appimage_extracted_4efc14/resources/app.asar/index.html" }));
  assert.ok(!modMatches(mod, { app: "joplin", url: "file:///tmp/.mount_JoplinXyZ789/resources/app.asar/note.html" }), "another page of the app");
  assert.ok(!modMatches(mod, { app: "obsidian", url: "file:///tmp/.mount_JoplinXyZ789/resources/app.asar/index.html" }), "another app");
  assert.ok(!modMatches({ match: { app: null, hosts: mod.match.hosts } }, { app: null, url: "file:///home/me/resources/app.asar/index.html" }), "not outside apps");
});

// ---------------------------------------------------------------- Trusted Types, in Chromium

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
let browser, site;
after(async () => { await browser?.close(); site?.close(); await fs.rm(home, { recursive: true, force: true }); });
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

test("Trusted Types (VS Code's window): the bar starts, the Mods panel says \"in this app\", and the page still can't use HTML strings", { skip: !chromium && "playwright not installed", timeout: 60000 }, async () => {
  // VS Code's CSP, cut down: HTML strings need a TrustedHTML from one of its own policies.
  site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "require-trusted-types-for 'script'; trusted-types app" })
    .end(`<!doctype html><title>Workbench</title><body style="background:#1e1e1e;color:#ccc"><div class="part statusbar">Ln 1, Col 1</div></body>`)).listen(0, "127.0.0.1");
  await new Promise(r => site.on("listening", r));
  const port = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  assert.equal(await page.evaluate(() => { try { document.body.innerHTML = "<b>x</b>"; return "allowed"; } catch { return "blocked"; } }), "blocked");

  const { Connector } = await import("../daemon/connector.js");
  const c = new Connector({ port, app: { id: "vscodium", name: "VSCodium" }, settings: { provider: "demo", model: "demo" }, log: () => {} });
  c.run();
  try {
    await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 20000 });
    const ui = sel => page.evaluate(s => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s)?.textContent || "", sel);
    // The UI the templates describe, built node by node: SVG in its namespace, the input, the buttons.
    assert.equal(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".bar .mark svg")?.namespaceURI), "http://www.w3.org/2000/svg");
    assert.equal(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".bar textarea.in")?.placeholder), "Describe a change…");
    await page.keyboard.press(OPEN_KEY);
    await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).open);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+Shift+KeyM");
    await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ctl-strip"));
    const strip = await ui(".ctl-strip");
    assert.match(strip, /Pause Morse on VSCodium/);
    assert.match(strip, /Stops every mod in this app/);
    assert.doesNotMatch(strip, /on this site/);
    // The page's own world is still protected.
    assert.equal(await page.evaluate(() => { try { document.body.insertAdjacentHTML("beforeend", "<b>x</b>"); return "allowed"; } catch { return "blocked"; } }), "blocked");
  } finally { await c.stop(); }
});

test("the HTML builder drops scripts, handlers and javascript: links", { skip: !chromium && "playwright not installed", timeout: 30000 }, async () => {
  browser ||= await chromium.launch();
  const page = await browser.newPage();
  const { bundleRuntime } = await import("../runtime/bundle.js");
  const src = (await fs.readFile(new URL("../runtime/src/00-trusted-html.js", import.meta.url), "utf8"));
  // Run the builder alone, as in an isolated world on a Trusted Types page.
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">`);
  const out = await page.evaluate(code => {
    globalThis.__morseHost = {};
    new Function(code)();
    const d = document.createElement("div");
    d.innerHTML = `<p class="a" title='x &amp; y'>one &lt;two&gt; &#8594;<br>three</p><script>window.ran=1<\/script><img src=x onerror="window.ran=2"><a href="javascript:alert(1)">l</a><iframe src="https://x.test"></iframe><style>.a > b { color: red }</style><textarea>&lt;b&gt;</textarea><svg viewBox="0 0 2 2"><path d="M0 0"/></svg>`;
    return { html: d.innerHTML, ran: window.ran || 0, svg: d.querySelector("path")?.namespaceURI, style: d.querySelector("style").textContent, ta: d.querySelector("textarea").value };
  }, src);
  assert.ok(bundleRuntime().includes("00-trusted-html.js"), "in the runtime, first");
  assert.equal(out.ran, 0);
  assert.doesNotMatch(out.html, /script|onerror|javascript:|iframe/);
  assert.match(out.html, /<p class="a" title="x &amp; y">one &lt;two&gt; →<br>three<\/p>/);
  assert.equal(out.svg, "http://www.w3.org/2000/svg");
  assert.equal(out.style, ".a > b { color: red }");
  assert.equal(out.ta, "<b>");
  await page.close();
});
