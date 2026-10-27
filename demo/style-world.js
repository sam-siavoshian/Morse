// Your style on three demo sites at once, each on its own address, for
// tests/style-ui.test.js, demo/shoot-style.js and the real-model try
// (demo/style-fit-real.js). Everything is real: the Morse helper's desktop
// connector attaches to Chromium over CDP (as with `morse attach`), reads and
// writes ~/.morse (MORSE_HOME must be set before this is imported), and runs
// the runtime from runtime/src.
//
//   byte.test     The Daily Byte (demo/sites/byte): an article with links
//   tunes.test    Tunes (demo/sites/tunes): a music app
//   library.test  Riverside Library (demo/sites/a11y): an autoplaying video, a moving ticker
//   mail.test     Postbox (demo/sites/mail): a fourth site, never visited first
import { promises as fs } from "node:fs";
import path from "node:path";
import net from "node:net";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const SITES = { byte: "byte", tunes: "tunes", library: "a11y", mail: "mail" };
export const originOf = name => `http://${name}.test`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".gif": "image/gif", ".webm": "video/webm", ".svg": "image/svg+xml", ".json": "application/json" };

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// launch(args) -> a Playwright Browser. settings: the connector's model.
export async function openStyleWorld({ launch, settings = { provider: "demo", model: "demo" }, viewport = { width: 1100, height: 760 }, scale = 1, log = () => {} }) {
  const home = process.env.MORSE_HOME;
  if (!home) throw new Error("Set MORSE_HOME before opening the style world");
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true } }));

  const { Connector } = await import("../daemon/connector.js");
  const port = await freePort();
  const browser = await launch([`--remote-debugging-port=${port}`, "--autoplay-policy=no-user-gesture-required"]);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
  await ctx.addInitScript(() => { try { localStorage.setItem("morse:debug", "1"); } catch {} });
  for (const [name, dir] of Object.entries(SITES)) {
    await ctx.route(`${originOf(name)}/**`, async route => {
      let p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(root, "demo", "sites", dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
      try { await route.fulfill({ body: await fs.readFile(file), contentType: TYPES[path.extname(file)] || "application/octet-stream" }); }
      catch { await route.fulfill({ status: 404, body: "" }).catch(() => {}); }
    });
  }
  let conn = new Connector({ port, app: null, settings, log, interval: 300 });
  let running = conn.run();

  async function ready(page, timeout = 60000) {
    const end = Date.now() + timeout;
    for (;;) {
      const s = await page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null")).catch(() => null);
      if (s?.ready) return s;
      if (Date.now() > end) throw new Error(`Morse didn't start on ${page.url()}`);
      await sleep(50);
    }
  }
  return {
    browser, ctx, home,
    async open(name, pathname = "/") {
      const page = await ctx.newPage();
      page.errors = [];
      page.on("pageerror", e => page.errors.push(e.message));
      await page.goto(originOf(name) + pathname);
      await ready(page);
      return page;
    },
    ready,
    get conn() { return conn; },
    // The Morse helper stops, then attaches again: what was saved is all that's left.
    async reconnect() {
      await conn.stop().catch(() => {});
      await running.catch(() => {});
      conn = new Connector({ port, app: null, settings, log, interval: 300 });
      running = conn.run();
    },
    async close() {
      await conn.stop().catch(() => {});
      await running.catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
