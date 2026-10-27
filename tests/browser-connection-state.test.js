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
