import { home } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Connector } from "../daemon/connector.js";
import { presentApp } from "../daemon/open-bar.js";

test("browser internal pages wait for a website, then connect when its world is ready", async () => {
  let changes = 0;
  const connector = {
    app: { browser: true }, windows: new Map(), pages: new Map(), retry: new Map(),
    changed() { changes++; },
    async attach(t) { this.windows.set(t.id, { ready: false }); },
  };
  const sync = list => Connector.prototype.sync.call(connector, list);
  const shown = () => presentApp("connected", connector);
  const internal = [{ id: "new", type: "page", url: "chrome://newtab/" },
    { id: "settings", type: "page", url: "chrome://settings/" }];
  sync(internal);
  assert.deepEqual(shown(), { state: "waiting-page", canStop: true });
  assert.equal(connector.pages.size, 0, "internal pages must not be injected");
  assert.equal(changes, 1);
  sync(internal);
  assert.equal(changes, 1, "unchanged state does not notify again");
  const page = { id: "web", type: "page", url: "https://example.com/" };
  sync([...internal, page]);
  assert.deepEqual(shown(), { state: "connecting", canStop: true });
  connector.windows.set(page.id, { ready: true, frameId: "f", frames: new Map([["f", { world: 7 }]]) });
  assert.deepEqual(shown(), { state: "connected", canStop: false });
  connector.windows.clear();
  connector.pages.clear();
  sync(internal);
  assert.deepEqual(shown(), { state: "waiting-page", canStop: true });
  assert.deepEqual(presentApp("waiting", connector), { state: "waiting", canStop: false }, "a closed browser still waits for relaunch");
  await Promise.resolve();
});

test("an app without a ready window still shows an actual connection attempt", () => {
  assert.deepEqual(presentApp("connected", { windows: new Map() }), { state: "connecting", canStop: true });
});

test("Chrome with no app id still waits for a website instead of spinning on Connecting", () => {
  const connector = {
    app: null, browserHost: { name: "Chrome", id: "chrome" },
    windows: new Map(), pages: new Map(), retry: new Map(), changed() {}, attach() {},
  };
  Connector.prototype.sync.call(connector, [{ id: "n", type: "page", url: "chrome://newtab/", title: "New Tab" }]);
  assert.equal(connector.needsPage, true);
  assert.ok(!connector.connectStalled);
  assert.deepEqual(presentApp("connected", connector), { state: "waiting-page", canStop: true });
});

test("pages attach two at a time, newest website first", () => {
  const started = [];
  const connector = {
    app: { browser: true }, windows: new Map(), pages: new Map(), retry: new Map(),
    attachSlots: 2, changed() {},
    attach(t) { started.push(t.id); return new Promise(() => {}); },
  };
  const pages = [1, 2, 3, 4].map(i => ({ id: `p${i}`, type: "page", url: `https://ex.test/${i}`, title: String(i) }));
  pages.push({ id: "frame", type: "iframe", url: "https://ex.test/1/in", title: "in", parentId: "p1" });
  Connector.prototype.sync.call(connector, pages);
  assert.deepEqual(started, ["p4", "p3"]);
  assert.equal(connector.pages.size, 2);
});

test("three failed attaches stop the Connecting row", () => {
  const connector = {
    app: null, browserHost: { name: "Chrome", id: "chrome" },
    windows: new Map(), pages: new Map(),
    retry: new Map([["p", { at: Date.now() + 60_000, n: 3 }]]),
    changed() {},
    attach() { throw new Error("should not retry a page that already failed"); },
  };
  Connector.prototype.sync.call(connector, [{ id: "p", type: "page", url: "https://example.com/", title: "Example" }]);
  assert.equal(connector.connectStalled, true);
  assert.deepEqual(presentApp("connected", connector), { state: "no-answer", canStop: true });
  assert.deepEqual(presentApp("connecting", connector), { state: "no-answer", canStop: true });
});

test("a hung tab is aborted so the next page can connect", async () => {
  const { waitFor } = await import("./helpers/wait.js");
  const connector = new Connector({
    browserHost: { name: "Chrome", id: "chrome" },
    attachTimeout: 200,
    attachSlots: 1,
    log() {},
    browser: {
      async connect(target) {
        if (target.id === "hung") return { send: () => new Promise(() => {}), on() {}, close() { this.closed = true; } };
        return {
          send: async method => {
            if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "f" } } };
            if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
            if (method === "Runtime.evaluate") return { result: { value: [false, "function"] } };
            return {};
          },
          on() {},
          close() {},
        };
      },
      close() {},
    },
  });
  const t0 = Date.now();
  connector.sync([
    { id: "fast", type: "page", url: "https://fast.test/", title: "Fast" },
    { id: "hung", type: "page", url: "https://slow.test/", title: "Slow" },
  ]);
  await waitFor(() => connector.windows.get("fast")?.ready, { timeout: 2000, interval: 20, what: "the other page" });
  assert.ok(Date.now() - t0 < 1500, "the hung tab must not hold the only slot");
  assert.ok(connector.retry.get("hung")?.n >= 1);
  connector.running = false;
});

test("a browser that never answers leaves Connecting", async () => {
  const { waitFor } = await import("./helpers/wait.js");
  const logs = [];
  const connector = new Connector({
    browser: { listTargets: async () => { throw new Error("down"); }, close() {} },
    browserHost: { name: "Chrome", id: "chrome" },
    interval: 10,
    startBudget: 30,
    log: line => logs.push(line),
  });
  const done = connector.run();
  await waitFor(() => connector.connectStalled, { timeout: 2000, interval: 10, what: "give up" });
  assert.deepEqual(presentApp("connecting", connector), { state: "no-answer", canStop: true });
  assert.match(logs.join("\n"), /Chrome didn't answer/);
  await connector.stop();
  await done;
});

test("opening Chrome records that it is a browser, so a new tab is not Connecting", async () => {
  const { startSession } = await import("../daemon/desktop.js");
  const { waitFor } = await import("./helpers/wait.js");
  const browser = {
    kind: "port", port: null, close() {},
    listTargets: async () => [{ id: "n", type: "page", url: "chrome://newtab/", title: "New Tab" }],
  };
  const session = startSession({
    browser, app: { id: "chrome", name: "Chrome", browser: true },
    settings: { provider: "demo" }, log() {}, interval: 20,
  });
  await session.flushed;
  await waitFor(() => session.connector.needsPage === true, { timeout: 2000, interval: 15, what: "needsPage" });
  assert.equal(session.connector.app, null, "website mods stay per site");
  assert.equal(session.connector.browserHost.name, "Chrome");
  assert.deepEqual(presentApp("connected", session.connector), { state: "waiting-page", canStop: true });
  await session.stop();
});
