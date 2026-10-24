// extension/host.js (the content-script bridge) with a fake service-worker
// port: calls in flight when the worker restarts settle with an error.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const HOST = readFileSync(new URL("../extension/host.js", import.meta.url), "utf8");
const RPC = readFileSync(new URL("../runtime/src/01-rpc.js", import.meta.url), "utf8");

const event = () => { const fns = []; return { fns, addListener: f => fns.push(f), fire: (...a) => fns.forEach(f => f(...a)) }; };

function setup() {
  const ports = [];
  const chrome = {
    runtime: {
      onMessage: event(),
      connect() {
        const port = { sent: [], dead: false, onMessage: event(), onDisconnect: event() };
        port.postMessage = m => { if (port.dead) throw new Error("Attempting to use a disconnected port object"); port.sent.push(m); };
        port.crash = () => { port.dead = true; port.onDisconnect.fire(); }; // Chrome recycled the worker
        ports.push(port);
        return port;
      },
    },
  };
  const window = { addEventListener() {} };
  window.top = window;
  const ctx = vm.createContext({ chrome, window, location: { href: "https://a.com/x", origin: "https://a.com" }, document: { documentElement: { dataset: {} } }, console });
  vm.runInContext(HOST, ctx);
  // The runtime's real RPC layer on top (01-rpc.js), so we see its promises settle.
  const call = vm.runInContext(`(function () {\n${RPC}\nreturn call;\n})()`, ctx);
  return { ports, call, ctx };
}

test("a worker restart fails in-flight calls instead of leaving them hanging", async () => {
  const { ports, call } = setup();
  const a = call("mods.list"), b = call("generate", { genId: "g1" });
  assert.equal(ports.length, 1);
  const [first] = ports;
  assert.deepEqual(first.sent.map(m => [m.id, m.type, m.url]), [[1, "mods.list", "https://a.com/x"], [2, "generate", "https://a.com/x"]]);
  first.onMessage.fire({ reply: 1, result: ["m"] }); // one answered
  assert.deepEqual(await a, ["m"]);
  first.crash();
  await assert.rejects(b, /Morse restarted\. Try again\./);

  // The next call reconnects and works.
  const c = call("hello");
  assert.equal(ports.length, 2);
  ports[1].onMessage.fire({ reply: ports[1].sent[0].id, result: "hi" });
  assert.equal(await c, "hi");
});

test("an answered call is not failed again by a later restart", async () => {
  const { ports, call } = setup();
  const settled = [];
  const p = call("history.get").then(r => settled.push(["ok", r]), e => settled.push(["err", e.message]));
  ports[0].onMessage.fire({ reply: 1, result: [] });
  await p;
  ports[0].crash();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(settled, [["ok", []]]);
});

test("a port that died before onDisconnect fired is replaced on send", async () => {
  const { ports, call } = setup();
  const hello = call("hello");
  ports[0].dead = true; // dead, no onDisconnect yet
  const p = call("mods.list");
  const later = call("history.get");
  assert.equal(ports.length, 2, "reconnected");
  assert.deepEqual(ports[1].sent.map(m => m.type), ["mods.list", "history.get"]);
  // The old port's disconnect arrives late: it fails only what went out on it.
  ports[0].onDisconnect.fire();
  await assert.rejects(hello, /Morse restarted/);
  ports[1].onMessage.fire({ reply: ports[1].sent[0].id, result: [] });
  assert.deepEqual(await p, []);
  ports[1].onMessage.fire({ reply: ports[1].sent[1].id, result: ["x"] });
  assert.deepEqual(await later, ["x"]);
});
