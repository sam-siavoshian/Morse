// Live proof of the services pipeline: an observe mod TAPS a real native
// process (emits a JSON event from inside it), the event flows out to the
// ServiceBus (the daemon), a provider turns it into a payload, and the renderer
// shows it — all with the real repo modules. (Uses Frida spawn; see the other
// example's note on attach-vs-spawn in this container.)
import frida from "/home/user/Morse/node_modules/frida/build/src/frida.js";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { buildAgentSource } from "../agent.js";
import { createModSpec } from "../schema.js";
import { defineProvider } from "../services/providers.js";
import { createServiceRuntime } from "../services/index.js";

const TGT = fileURLToPath(new URL("./ticketd", import.meta.url));
const SIG = "f3 0f 1e fa 89 7c 24 f8 89 74 24 fc 8b 44 24 f8 8b 54 24 fc 0f af c2 c3";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The tap: an observe mod on compute_total that emits the qty it was called
// with. No heavy logic in-process — just emit({...}).
const tap = createModSpec({
  title: "Tap ticket purchases",
  match: { format: "elf" },
  target: { kind: "signature", module: "ticketd", pattern: SIG },
  action: { kind: "observe", onEnter: "emit({ type:'ticket', qty: args[1].toInt32() })" },
  active: true,
});

// The daemon side: a provider that looks up the tier for a qty (here a local
// computation; in a real feature this is a network/LLM/transcription call).
const tierProvider = defineProvider({
  name: "tier", match: e => e.type === "ticket", key: e => String(e.qty),
  fetch: async e => ({ kind: "info", title: `qty ${e.qty}`, body: e.qty >= 3 ? "bulk tier — eligible for the 20% discount" : "standard tier", generated: false }),
});

const session = new EventEmitter();
const seen = new Set();
const rt = createServiceRuntime({
  session, providers: [tierProvider], mode: "overlay", request: async () => ({}), minIntervalMs: 0,
  apply: msg => { if (msg.data) { seen.add(msg.data.title); console.log(`  [render HUD] ${msg.data.title}: ${msg.data.body}`); } },
});

const dev = await frida.getLocalDevice();
const pid = await dev.spawn([TGT], { stdio: "pipe" });
const s = await dev.attach(pid);
const script = await s.createScript(buildAgentSource([tap]));
script.message.connect(m => { if (m.type === "send" && m.payload?.type === "tap") session.emit("tap", { id: m.payload.id, data: m.payload.data }); });
await script.load();
console.log("tap installed:", JSON.stringify(await script.exports.apply([tap])));
await dev.resume(pid);

console.log("\nApp runs; each purchase taps out an event → daemon → render:\n");
await sleep(4500);

rt.stop();
await script.unload().catch(() => {});
await s.detach().catch(() => {});
await dev.kill(pid).catch(() => {});
console.log(`\nDistinct tiers rendered from live taps: ${seen.size} (qty 1..5)`);
process.exit(0);
