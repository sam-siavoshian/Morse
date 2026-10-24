// "Bring your own harness": runs generations through a coding-agent CLI the
// user already has and is signed into: Claude Code (`claude`) or Codex
// (`codex`). The prompt contains untrusted page text, so every run:
//   - has all tools disabled (Claude Code: --tools "" and no MCP servers;
//     Codex: read-only sandbox, shell/web tools and MCP servers switched off),
//   - runs in an empty directory under ~/.morse (no CLAUDE.md / AGENTS.md),
//   - is killed on timeout (120s) and when the caller aborts.

import { trace } from "./trace.js"; // MORSE_TRACE
import { spawn } from "node:child_process";
import { promises as fs, statSync, accessSync, constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HOME } from "./store.js";
import { registerProvider, flattenConversation, abortError, imageBlocks } from "../core/providers.js";
import { SYSTEM_PROMPT } from "../core/prompt.js";
import { warmSettings } from "../core/route.js"; // models: keep the first model warm

export const TIMEOUT_MS = 120_000;
const MODEL_RE = /^[A-Za-z0-9][\w.:/\[\]-]{0,80}$/;

export function which(cmd, envPath = process.env.PATH || "") {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map(e => e.toLowerCase()) : [""];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try {
        if (!statSync(p).isFile()) continue;
        if (process.platform !== "win32") accessSync(p, constants.X_OK);
        return p;
      } catch {}
    }
  }
  return null;
}

export function detectHarnesses() {
  const claude = which("claude"), codex = which("codex");
  return { claude: { found: !!claude, path: claude }, codex: { found: !!codex, path: codex } };
}

export function validModel(m) {
  return !m || MODEL_RE.test(m);
}

// A fresh empty working directory per run, removed afterwards.
async function runDir() {
  const root = path.join(HOME, "run");
  await fs.mkdir(root, { recursive: true });
  const dir = path.join(root, crypto.randomBytes(6).toString("hex"));
  await fs.mkdir(path.join(dir, "cwd"), { recursive: true });
  return dir;
}

// Starts a CLI with stdin open. Its stdout lines wait in a queue until
// runProcess listens, so a process can start before its request exists.
function launch({ bin, args, cwd, env = process.env }) {
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  const child = spawn(shell ? `"${bin}"` : bin, shell ? args.map(a => `"${a.replace(/"/g, '""')}"`) : args, {
    cwd, shell, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env,
  });
  const h = { child, stderr: "", queue: [], onLine: null, onClose: null, closed: false, code: null, error: null };
  let buf = "";
  const deliver = line => (h.onLine ? h.onLine(line) : h.queue.push(line));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) deliver(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", d => { h.stderr = (h.stderr + d).slice(-4000); });
  child.stdin.on("error", () => {});
  const closed = (code, error) => {
    if (h.closed) return;
    if (buf.trim()) { deliver(buf.trim()); buf = ""; }
    Object.assign(h, { closed: true, code, error });
    h.onClose?.(code, error);
  };
  child.on("error", e => closed(null, e));
  child.on("close", code => closed(code, null));
  return h;
}
const running = h => !h.closed && h.child.exitCode === null && h.child.signalCode === null;
function stop(h) {
  if (!running(h)) return;
  // Windows: claude.cmd and codex.cmd run under cmd.exe, and ending cmd.exe
  // leaves Claude Code or Codex running. End the whole process tree.
  if (process.platform === "win32" && h.child.pid) {
    try { spawn("taskkill", ["/PID", String(h.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {}); } catch {}
  }
  try { h.child.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { if (running(h)) h.child.kill("SIGKILL"); } catch {} }, 2000).unref();
}
// A process that is only waiting must not keep Morse itself running.
function hold(h, on) {
  for (const x of [h.child, h.child.stdin, h.child.stdout, h.child.stderr]) try { on ? x?.ref?.() : x?.unref?.(); } catch {}
}

// Runs a CLI (or one started earlier, `proc`), writes `input` to stdin and
// calls onLine(line, finish) for each stdout line. Resolves { code, stderr }
// when it exits, or as soon as onLine calls finish(): speed, the answer is
// complete, so Morse doesn't wait for the CLI's own wrap-up (it exits by
// itself, or is stopped a moment later). Rejects on abort/timeout (after
// killing it).
export function runProcess({ bin, args, input, cwd, signal, timeoutMs = TIMEOUT_MS, onLine, proc, env }) {
  return new Promise((resolve, reject) => {
    const h = proc || launch({ bin, args, cwd, env });
    hold(h, true);
    let done = false, why = null;
    const kill = reason => {
      if (done || why) return;
      why = reason;
      stop(h);
    };
    const onAbort = () => kill("abort");
    const timer = setTimeout(() => kill("timeout"), timeoutMs);
    const settle = fn => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const finish = () => settle(() => {
      resolve({ code: null, stderr: h.stderr, early: true });
      setTimeout(() => stop(h), 3000).unref();
    });
    h.onLine = line => { if (!done) try { onLine(line, finish); } catch (e) { kill(e); } };
    h.onClose = (code, error) => settle(() => {
      if (error) return reject(error);
      if (why === "abort") return reject(abortError());
      if (why === "timeout") return reject(new Error(`The model took longer than ${Math.round(timeoutMs / 1000)}s, so Morse stopped it. Try a smaller change.`));
      if (why instanceof Error) return reject(why);
      resolve({ code, stderr: h.stderr });
    });
    for (const line of h.queue.splice(0)) h.onLine(line);
    if (h.closed) return h.onClose(h.code, h.error);
    h.child.stdin.end(input);
  });
}

const lastLine = s => (s || "").trim().split("\n").filter(Boolean).pop() || "";

// ---- Claude Code: `claude -p`, one request per process. The request goes in
// as one stream-json user message; token text comes back as
// stream_event/content_block_delta/text_delta, and the last line is a `result`.
//
// speed: starting `claude` takes 1 to 3 seconds before it can send anything,
// so Morse starts the next process ahead of time (when the bar opens, and
// after each request) and gives the next request to it. A started process
// still answers exactly one request and exits, in its own fresh empty
// directory with no session saved, so nothing carries over between requests.
// It only takes a request whose settings, instructions and environment match
// the ones it started with, and stops after WARM_IDLE_MS unused.
// MORSE_WARM=0 turns this off.
export const WARM_IDLE_MS = 5 * 60_000;
let warm = []; // started processes waiting for a request: { key, ready, dead, timer }
let warmMax = 1; // one person, one request at a time
let keepOthers = false;
// The eval runs several cases at once, like several people (evals/run.js).
// keepOthers: it also compares models side by side (--model sonnet,opus,auto),
// each with its own processes (settings "pool"), so starting one doesn't stop another's.
export function setWarmPoolSize(n, { keepOthers: k = false } = {}) { warmMax = Math.max(0, n | 0); keepOthers = k; }

// Background calls Claude Code makes that a one-shot answer doesn't need
// (update checks, error reports, a summary of each turn after it ends).
const claudeEnv = () => ({ ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? "1" });
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
function claudeArgs(s, sysFile) {
  return [
    "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--include-partial-messages",
    "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
    "--system-prompt-file", sysFile,
    ...(s.model ? ["--model", s.model] : []),
    ...(EFFORTS.has(s.effort) ? ["--effort", s.effort] : []),
  ];
}
const claudeKey = (bin, s, system) => crypto.createHash("sha256")
  .update(JSON.stringify([bin, s.model || "", s.effort || "", system, process.env, s.pool || ""])).digest("hex");

async function startClaude(bin, s, system) {
  const dir = await runDir();
  const sysFile = path.join(dir, "system.txt");
  await fs.writeFile(sysFile, system);
  const h = launch({ bin, args: claudeArgs(s, sysFile), cwd: path.join(dir, "cwd"), env: claudeEnv() });
  const rm = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  h.child.once("close", rm);
  h.child.once("error", rm);
  return h;
}
function dropWarm(w) {
  clearTimeout(w.timer);
  warm = warm.filter(x => x !== w);
  w.ready.then(h => h && stop(h));
}
// Starts a process for the next request, unless enough are already waiting.
export function prewarmClaudeCode(s = {}, system = SYSTEM_PROMPT) {
  if (process.env.MORSE_WARM === "0" || !system || !warmMax) return false;
  const bin = s.bin || which("claude");
  if (!bin || !validModel(s.model)) return false;
  const key = claudeKey(bin, s, system);
  for (const w of warm.filter(x => (x.key !== key && !keepOthers) || x.dead)) dropWarm(w); // settings changed: those are no use now
  const same = warm.filter(x => x.key === key);
  for (const w of same) { clearTimeout(w.timer); w.timer = setTimeout(() => dropWarm(w), WARM_IDLE_MS).unref(); }
  if (same.length >= warmMax) return true;
  const w = { key, dead: false };
  w.ready = startClaude(bin, s, system).then(h => {
    hold(h, false);
    h.onClose = () => { w.dead = true; if (warm.includes(w)) dropWarm(w); };
    if (!warm.includes(w)) { stop(h); return null; }
    return h;
  }, () => { w.dead = true; warm = warm.filter(x => x !== w); return null; });
  w.timer = setTimeout(() => dropWarm(w), WARM_IDLE_MS).unref();
  warm.push(w);
  return true;
}
// A waiting process that matches and is still running, or null.
async function takeWarm(key) {
  const w = warm.find(x => x.key === key && !x.dead);
  if (!w) return null;
  warm = warm.filter(x => x !== w);
  clearTimeout(w.timer);
  const h = await w.ready;
  if (!h || !running(h) || w.dead) { if (h) stop(h); return null; }
  h.onClose = null;
  return h;
}

export async function claudeCodeStream(s, messages, { onToken, signal, onStage }) {
  const bin = s.bin || which("claude");
  if (!bin) throw new Error("Claude Code isn't installed on this computer. Install it from claude.com/claude-code, or run morse setup to choose another model.");
  if (!validModel(s.model)) throw new Error(`"${s.model}" isn't a model name Morse can use. Check the spelling.`);
  const { system, prompt } = flattenConversation(messages);
  const t0 = Date.now();
  const key = claudeKey(bin, s, system);
  const reused = await takeWarm(key);
  trace("harness", `${reused ? "using a Claude Code process started when the bar opened" : "starting Claude Code now"}: ${path.basename(bin)} ${claudeArgs(s, "<morse instructions>").map(a => a === "" ? '""' : a).join(" ")}`);
  const h = reused || await startClaude(bin, s, system);
  // Describe this image (core/a11y.js): pictures travel in the same user message.
  const images = imageBlocks(messages);
  const input = JSON.stringify({ type: "user", message: { role: "user", content: images.length ? [...images, { type: "text", text: prompt }] : prompt } }) + "\n";
  let text = "", result = null, stopReason = null;
  try {
    const { code, stderr, early } = await runProcess({
      proc: h, input, signal, timeoutMs: s.timeoutMs,
      onLine(line, finish) {
        let ev;
        try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "system" && ev.subtype === "init") { trace("harness", `Claude Code ready (${ev.model || s.model || "default model"}), request sent on stdin as stream-json`); onStage?.({ stage: "ready", spawnMs: Date.now() - t0, warm: !!reused }); }
        else if (ev.type === "system" && ev.subtype === "thinking_tokens") onStage?.({ stage: "thinking" });
        else if (ev.type === "stream_event") {
          const e = ev.event;
          if (e?.type === "content_block_start" && e.content_block?.type === "thinking") onStage?.({ stage: "thinking" });
          else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
            const t = e.delta.text || "";
            if (t) { text += t; onToken?.(t); }
          } else if (e?.type === "message_delta") stopReason = e.delta?.stop_reason || stopReason;
          // speed: the answer is complete at message_stop; the CLI's wrap-up
          // after it (usage, a result line, exiting) can take seconds.
          else if (e?.type === "message_stop" && text && stopReason !== "refusal") finish();
        } else if (ev.type === "result") result = ev;
      },
    });
    if (early) return text;
    if (result && !result.is_error && (!result.subtype || result.subtype === "success")) {
      const full = typeof result.result === "string" ? result.result : text;
      // No partial messages (older CLI): emit whatever we didn't stream.
      if (full.startsWith(text) && full.length > text.length) { onToken?.(full.slice(text.length)); text = full; }
      return text || full;
    }
    const why = (typeof result?.result === "string" && result.result) || result?.errors?.join?.("; ") || result?.subtype || lastLine(stderr) || `exited with code ${code}`;
    throw new Error(`Claude Code: ${why}`);
  } finally {
    // The next request starts warm (unless this one was stopped), with the
    // usual instructions: a one-off request (describing a picture) doesn't
    // take the place of the common case. models: and with the model requests
    // start on (sonnet), also after one that went to the strong model.
    if (!signal?.aborted) prewarmClaudeCode(s.warmAs || warmSettings(s)); // warmAs: the helper, for Chrome (daemon/bridge.js)
  }
}

// Codex: `codex exec --json`, prompt on stdin. Handles both JSONL shapes:
//   new: {"type":"item.completed","item":{"type":"agent_message","text":...}}
//        (+ item.started/item.updated, and delta events when present)
//   old: {"msg":{"type":"agent_message_delta","delta":...}} / {"msg":{"type":"agent_message","message":...}}
export async function codexStream(s, messages, { onToken, signal }) {
  const bin = s.bin || which("codex");
  if (!bin) throw new Error("Codex isn't installed on this computer. Install it with npm i -g @openai/codex, or run morse setup to choose another model.");
  if (!validModel(s.model)) throw new Error(`"${s.model}" isn't a model name Morse can use. Check the spelling.`);
  const { system, prompt } = flattenConversation(messages);
  const dir = await runDir();
  const input = `<instructions>\n${system}\nAnswer directly in your reply. Do not run commands, read files, or edit files.\n</instructions>\n\n${prompt}`;
  const args = [
    "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", path.join(dir, "cwd"),
    "-c", "mcp_servers={}", "-c", "features.shell_tool=false", "-c", "features.web_search_request=false",
    ...(s.model ? ["-m", s.model] : []),
    ...(EFFORTS.has(s.effort) ? ["-c", `model_reasoning_effort=${s.effort}`] : []), // models: Codex's fast and strong tiers
    "-",
  ];
  let text = "";           // everything emitted through onToken
  const items = new Map(); // item id -> text emitted for that item
  const finals = [];
  let error = null, sawDelta = false;
  const isMsg = it => it && (it.type === "agent_message" || it.item_type === "agent_message" || it.item_type === "assistant_message");
  const emit = t => { if (t) { text += t; onToken?.(t); } };
  const progress = (id, full) => {
    const seen = items.get(id) ?? "";
    if (full.startsWith(seen) && full.length > seen.length) {
      // Separate consecutive messages.
      if (!seen && text && !text.endsWith("\n")) emit("\n");
      emit(full.slice(seen.length));
      items.set(id, full);
    }
  };
  try {
    const { code, stderr } = await runProcess({
      bin, args, input, cwd: path.join(dir, "cwd"), signal, timeoutMs: s.timeoutMs,
      onLine(line) {
        let ev;
        try { ev = JSON.parse(line); } catch { return; }
        const m = ev.msg;
        if (m) {
          if (m.type === "agent_message_delta" || m.type === "agent_message_content_delta") { sawDelta = true; emit(m.delta || ""); }
          else if (m.type === "agent_message") { finals.push(m.message || ""); if (!sawDelta) progress(ev.id ?? finals.length, m.message || ""); }
          else if (m.type === "error" || m.type === "stream_error") error = m.message;
          return;
        }
        const it = ev.item;
        if ((ev.type === "item.started" || ev.type === "item.updated") && isMsg(it) && typeof it.text === "string") progress(it.id, it.text);
        else if (ev.type === "item.completed" && isMsg(it)) { finals.push(it.text || ""); progress(it.id, it.text || ""); }
        else if (/delta$/.test(ev.type || "") && typeof ev.delta === "string") { sawDelta = true; emit(ev.delta); }
        else if (ev.type === "turn.failed") error = ev.error?.message || "turn failed";
        else if (ev.type === "error") error = ev.message || ev.error?.message || "error";
      },
    });
    if (error && !finals.length) throw new Error(`Codex: ${error}`);
    if (code !== 0 && !finals.length && !text) throw new Error(`Codex: ${lastLine(stderr) || `exited with code ${code}`}`);
    const full = finals.join("\n");
    return text.length >= full.length ? text : full;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

registerProvider("claude-code", claudeCodeStream, { warm: s => prewarmClaudeCode(s) });
registerProvider("codex", codexStream);
