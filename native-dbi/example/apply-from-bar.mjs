// Live proof of the native "apply" plumbing: a (simulated) bar submit flows
// through NativeModService → a planner (the model seam, a rule here) → the real
// Frida agent on the stripped ticketd binary → the behaviour changes → it's
// saved → Undo reverts it. The only stand-in is the planner; everything else is
// the shipped code path.
//
// Run (needs `npm install frida` + the built target — see README.md):
//   cc -O1 -o native-dbi/example/ticketd native-dbi/example/ticketd.c && strip native-dbi/example/ticketd
//   node native-dbi/example/apply-from-bar.mjs
import frida from "frida";
import { fileURLToPath } from "node:url";
import { buildAgentSource } from "../agent.js";
import { createContext } from "../schema.js";
import { createStore } from "../store.js";
import { NativeModService } from "../apply.js";

const TGT = fileURLToPath(new URL("./ticketd", import.meta.url));
const SIG = "f3 0f 1e fa 89 7c 24 f8 89 74 24 fc 8b 44 24 f8 8b 54 24 fc 0f af c2 c3";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The model seam: turn a sentence into a ModSpec. A rule stands in for the model.
const planner = async (req) => /discount|% ?off|cheaper|bulk/i.test(req.prompt)
  ? { ok: true, spec: { title: req.prompt, target: { kind: "signature", module: "ticketd", pattern: SIG }, action: { kind: "replace", retType: "int", argTypes: ["int", "int"], body: "const base=args[0],qty=args[1];const total=base*qty;return qty>=3?Math.trunc(total*0.8):total;" } } }
  : { ok: false, error: "this demo's planner only knows the discount." };

// In-memory store so the demo doesn't write to ~/.morse.
let blob = null;
const store = createStore({ file: "mem", fs: { read: () => { if (blob == null) throw 0; return blob; }, write: (_p, c) => { blob = c; }, rename: () => {}, mkdir: () => {} } });

const dev = await frida.getLocalDevice();
let buf = "";
dev.output.connect((_pid, fd, data) => { if (fd === 1 || fd === 2) buf += data.toString(); });
const tail = (n = 5) => buf.trim().split("\n").filter(Boolean).slice(-n).join("\n");
const clear = () => { buf = ""; };

const pid = await dev.spawn([TGT], { stdio: "pipe" });
const session = await dev.attach(pid);
const script = await session.createScript(buildAgentSource([]));
await script.load();
await dev.resume(pid);

// A minimal session adapter over the real agent (apply/revert) — what the
// NativeSession exposes, scoped to this demo's spawn flow.
const sessionAdapter = {
  apply: specs => script.exports.apply(specs),
  revert: id => script.exports.revert(id),
};
const context = createContext({ pid, exe: TGT, format: "elf", arch: "x86_64" });
const svc = new NativeModService({ session: sessionAdapter, context, planner, store, onEvent: (k, e) => console.log(`  · ${k}: ${JSON.stringify(e)}`) });

await sleep(1500);
console.log("── BEFORE (app as shipped) ──\n" + tail() + "\n");

// 1) The bar submit.
clear();
console.log('bar submit → "give bulk buyers 20% off"');
const res = await svc.generate({ prompt: "give bulk buyers 20% off" });
console.log("  result:", JSON.stringify(res), "| saved mods:", svc.list().map(m => m.title));
await sleep(2200);
console.log("\n── AFTER APPLY (feature live, and saved) ──\n" + tail() + "\n");

// 2) Undo.
clear();
console.log("Undo → setEnabled(false)");
await svc.setEnabled(res.id, false);
await sleep(2000);
console.log("── AFTER UNDO (reverted; still saved, now idle) ──\n" + tail());
console.log("  saved:", svc.list().map(m => `${m.title} [${m.applied ? "on" : "off"}]`));

await script.unload().catch(() => {});
await session.detach().catch(() => {});
await dev.kill(pid).catch(() => {});
process.exit(0);
