// REA, over its MCP interface, as a read-only binary inspector.
//
// REA (https://github.com/morluto/rea, MIT) analyses compiled binaries without
// running them: exports/imports, symbol names, procedure boundaries,
// disassembly and strings, via Hopper/Ghidra/IDA or offline parsers. Morse uses
// it to learn *what can be hooked* in a native target before Frida touches the
// process — the same read-only, static posture daemon/profile.js takes for
// Electron apps.
//
// Transport: REA's MCP server speaks stdio by default (spawned as a child), or
// streamable HTTP at /mcp on loopback when started with `rea mcp --http`. This
// module talks JSON-RPC 2.0 over whichever it's given. It is written as a thin
// adapter: the tool names below are REA's (open_binary, binary_session,
// inspect_macho, inspect_binary_layout, list_names, list_procedures,
// resolve_containing_procedure, analyze_function, read_bytes, list_strings),
// and the response-mapping is isolated in mapTools() so a REA version that
// renames or reshapes a tool is a one-place change.
//
// Nothing here instruments or modifies anything. It reads, and folds what it
// reads into the TargetContext's `symbols` and `candidates`.

import { spawn } from "node:child_process";

// ---- A minimal JSON-RPC client over a line-delimited stdio child ---------
//
// MCP's stdio framing is newline-delimited JSON. (If a REA build uses
// Content-Length framing instead, this is the one place to adjust.)
export class ReaStdioClient {
  constructor({ command = "rea", args = ["mcp"], env = process.env } = {}) {
    this.command = command; this.args = args; this.env = env;
    this.proc = null; this.buf = ""; this.id = 0; this.pending = new Map();
  }

  async start() {
    this.proc = spawn(this.command, this.args, { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", d => this.#onData(d));
    this.proc.on("exit", () => { for (const { reject } of this.pending.values()) reject(new Error("rea mcp exited")); this.pending.clear(); });
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "morse-native-dbi", version: "0" } });
    return this;
  }

  #onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || "rea error"));
      else p.resolve(msg.result);
    }
  }

  request(method, params, timeoutMs = 60000) {
    const id = ++this.id;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`rea ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      try { this.proc.stdin.write(payload); } catch (e) { reject(e); }
    });
  }

  // MCP tool call → the tool's structured result (its first JSON content).
  async call(name, args = {}) {
    const res = await this.request("tools/call", { name, arguments: args });
    const content = res?.content;
    if (Array.isArray(content)) {
      const json = content.find(c => c.type === "json" || c.json);
      if (json) return json.json ?? json.data ?? null;
      const text = content.find(c => c.type === "text");
      if (text) { try { return JSON.parse(text.text); } catch { return text.text; } }
    }
    return res?.structuredContent ?? res;
  }

  async stop() { try { this.proc?.kill(); } catch {} }
}

// ---- The inspection itself ------------------------------------------------

// Drive REA over `client` to inspect `exe` and return a map of what can be
// hooked. `format` steers which structural tool to use. `focus` is an optional
// list of words from the person's request used to shortlist procedures for the
// deeper analyze_function pass. Returns { symbols, candidates, strings }.
export async function inspectBinary(client, { exe, format, focus = [], provider = "auto", deep = 8 } = {}) {
  await client.call("open_binary", { path: exe, provider_id: provider });
  const session = await client.call("binary_session", {}).catch(() => ({}));
  const available = toolAvailability(session);

  const symbols = [];
  const candidates = [];
  let strings = [];

  // Exports / imports / dynamic symbols.
  if (format === "macho" && can(available, "inspect_macho")) {
    const ex = await client.call("inspect_macho", { detail: "summary", facet: "exports" }).catch(() => null);
    const im = await client.call("inspect_macho", { detail: "summary", facet: "imports" }).catch(() => null);
    pushSymbols(symbols, ex, "export");
    pushSymbols(symbols, im, "import");
  } else if (can(available, "inspect_binary_layout")) {
    const layout = await client.call("inspect_binary_layout", { detail: "summary", facet: "linkage" }).catch(() => null);
    pushSymbols(symbols, layout, "import");
  }
  if (can(available, "list_names")) {
    const names = await client.call("list_names", { detail: "summary" }).catch(() => null);
    pushSymbols(symbols, names, "symbol");
  }

  // Procedure boundaries → candidates.
  if (can(available, "list_procedures")) {
    const procs = await client.call("list_procedures", { detail: "summary" }).catch(() => null);
    for (const p of rows(procs)) {
      const c = asCandidate(p);
      if (c) candidates.push(c);
    }
  }

  // Deep pass on a shortlist: the procedures whose names best match the
  // request's words. analyze_function gives bytes we can turn into a signature
  // for a function that has no stable exported symbol.
  const shortlist = rankByFocus(candidates, focus).slice(0, Math.max(0, deep));
  if (can(available, "analyze_function")) {
    for (const c of shortlist) {
      if (c.address == null) continue;
      const dossier = await client.call("analyze_function", { address: hex(c.address), detail: "summary" }).catch(() => null);
      if (dossier) {
        c.analyzed = true;
        if (dossier.size != null) c.size = Number(dossier.size);
        if (Array.isArray(dossier.callers)) c.callers = dossier.callers.length;
        c.evidence = c.name ? "symbol+analysis" : "analysis";
      }
    }
  }

  if (can(available, "list_strings")) {
    const s = await client.call("list_strings", { detail: "summary" }).catch(() => null);
    strings = rows(s).map(r => (typeof r === "string" ? r : r.value || r.text)).filter(Boolean).slice(0, 500);
  }

  return { symbols: dedupe(symbols), candidates, strings };
}

// Fold an inspection result into a TargetContext (schema.createContext output).
export function enrichContext(context, inspection) {
  return { ...context, symbols: inspection.symbols, candidates: inspection.candidates, strings: inspection.strings };
}

// Convenience: start a client, inspect, stop. Returns the enriched context, or
// the context unchanged plus a warning if REA isn't available.
export async function inspectWithRea(context, { focus = [], clientOptions } = {}) {
  let client;
  try {
    client = await new ReaStdioClient(clientOptions).start();
  } catch (e) {
    return { context, warning: `REA not available (${e.message}). Install rea-agents and ensure \`rea\` is on PATH, or run \`rea mcp --http\`. Symbol maps skipped.` };
  }
  try {
    const inspection = await inspectBinary(client, { exe: context.exe, format: context.format, focus });
    return { context: enrichContext(context, inspection), warning: null };
  } catch (e) {
    return { context, warning: `REA inspection failed: ${e.message}` };
  } finally {
    await client.stop();
  }
}

// ---- Mapping helpers (the version-sensitive part, kept in one place) ------

function toolAvailability(session) {
  const ta = session?.tool_availability ?? session?.toolAvailability;
  if (Array.isArray(ta)) return new Set(ta);
  if (ta && typeof ta === "object") return new Set(Object.keys(ta).filter(k => ta[k]));
  return null; // unknown → optimistic; each call is already try/caught
}
const can = (set, name) => !set || set.has(name);

// REA tools return either an array, or { rows: [...] }, or { items/results/... }.
function rows(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  for (const k of ["rows", "items", "results", "entries", "symbols", "exports", "imports", "procedures", "strings", "names"]) {
    if (Array.isArray(res[k])) return res[k];
  }
  return [];
}

function pushSymbols(out, res, kind) {
  for (const r of rows(res)) {
    const name = typeof r === "string" ? r : r.name || r.symbol || r.demangled || null;
    if (!name) continue;
    const address = parseAddr(r?.address ?? r?.addr ?? r?.value ?? r?.rva);
    out.push({ name, address, kind: r?.kind || kind });
  }
}

function asCandidate(p) {
  if (!p || typeof p !== "object") return null;
  const address = parseAddr(p.address ?? p.start ?? p.entry ?? p.addr);
  const name = p.name || p.symbol || null;
  if (address == null && !name) return null;
  return { name, address, size: p.size != null ? Number(p.size) : null, evidence: name ? "symbol" : "procedure" };
}

function rankByFocus(candidates, focus) {
  if (!focus?.length) return candidates.filter(c => c.name).concat(candidates.filter(c => !c.name));
  const words = focus.map(w => String(w).toLowerCase()).filter(Boolean);
  const score = c => {
    const n = (c.name || "").toLowerCase();
    return words.reduce((s, w) => s + (n.includes(w) ? 1 : 0), 0);
  };
  return [...candidates].sort((a, b) => score(b) - score(a));
}

function dedupe(symbols) {
  const seen = new Set(); const out = [];
  for (const s of symbols) {
    const key = `${s.kind}:${s.name}:${s.address ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(s);
  }
  return out;
}

function parseAddr(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return Number(s);
    if (/^[0-9]+$/.test(s)) return Number(s);
  }
  return null;
}

const hex = n => (typeof n === "number" ? "0x" + n.toString(16) : String(n));
