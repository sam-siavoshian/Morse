// Worked example: add a feature to a real, stripped (closed-source-like) native
// binary with Morse's native-dbi agent + mod spec + signature scanner.
//
// It builds a declarative ModSpec that finds compute_total() in the stripped
// ticketd binary BY SIGNATURE (no symbols), and replaces it to add a 20%-off
// bulk discount for qty >= 3 — a feature the binary never shipped. Then it
// reverts, leaving the process exactly as it was.
//
// Run (needs `npm install frida` and the built target — see README.md):
//   cc -O1 -o native-dbi/example/ticketd native-dbi/example/ticketd.c
//   strip native-dbi/example/ticketd
//   node native-dbi/example/add-feature.mjs
//
// Session note: this opens the session with Frida `spawn` (launch under
// instrumentation). attach-to-already-running works on a normal machine but
// stalls on some container ptrace configs; the hooking path below
// (buildAgentSource, in-agent Memory.scan, Interceptor) is the real repo code
// either way.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAgentSource } from "../agent.js";
import { createModSpec, validateModSpec } from "../schema.js";
import { scan } from "../sigscan.js";

const TGT = fileURLToPath(new URL("./ticketd", import.meta.url));
// compute_total's opcode bytes (endbr64; load both args; imul; ret). No
// relocations, so no wildcards — stable across a rebuild of the same source.
const SIG = "f3 0f 1e fa 89 7c 24 f8 89 74 24 fc 8b 44 24 f8 8b 54 24 fc 0f af c2 c3";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const frida = await import("frida").then(m => m.default ?? m).catch(() => null);
if (!frida) { console.error("This example needs Frida: npm install frida"); process.exit(1); }

const spec = createModSpec({
  title: "Bulk discount for 3+ tickets",
  match: { format: "elf" },
  target: { kind: "signature", module: "ticketd", pattern: SIG },
  action: {
    kind: "replace", retType: "int", argTypes: ["int", "int"],
    body: "const base=args[0], qty=args[1]; const total=base*qty; if(qty>=3){ log('discount applied qty='+qty); return Math.trunc(total*0.8); } return total;",
  },
  active: true,
});
console.log("[schema] mod spec valid:", validateModSpec(spec).ok);
console.log(`[sigscan] signature matches in the stripped binary: ${scan(readFileSync(TGT), SIG).length} site\n`);

const dev = await frida.getLocalDevice();
let buf = "";
dev.output.connect((_pid, fd, data) => { if (fd === 1 || fd === 2) buf += data.toString(); });
const tail = (n = 6) => buf.trim().split("\n").filter(Boolean).slice(-n).join("\n");
const clear = () => { buf = ""; };

const pid = await dev.spawn([TGT], { stdio: "pipe" });
const session = await dev.attach(pid);
await dev.resume(pid);
await sleep(1700);
console.log("── BEFORE (app as shipped) ──\n" + tail() + "\n");

clear();
const script = await session.createScript(buildAgentSource([spec]));
script.message.connect(m => { if (m.type === "send" && m.payload?.type === "mod") console.log(`[agent ${m.payload.level}] ${m.payload.message}`); });
await script.load();
console.log("[agent] apply:", JSON.stringify(await script.exports.apply([spec])));
await sleep(2600);
console.log("\n── AFTER MORSE (new feature: 3+ tickets → 20% off) ──\n" + tail() + "\n");

clear();
await script.exports.detach();
await sleep(2000);
console.log("── AFTER DETACH (hook reverted, app unchanged) ──\n" + tail());

await script.unload().catch(() => {});
await session.detach().catch(() => {});
await dev.kill(pid).catch(() => {});
process.exit(0);
