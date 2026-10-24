// "Bring your own harness": runs generations through a coding-agent CLI the
// user already has and is signed into: Claude Code (`claude`) or Codex
// (`codex`). The prompt contains untrusted page text, so every run:
//   - has all tools disabled (Claude Code: --tools "" and no MCP servers;
//     Codex: read-only sandbox, shell/web tools and MCP servers switched off),
//   - runs in an empty directory under ~/.morse (no CLAUDE.md / AGENTS.md),
//   - is killed on timeout (120s) and when the caller aborts.

import { spawn } from "node:child_process";
import { promises as fs, statSync, accessSync, constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HOME } from "./store.js";
import { registerProvider, flattenConversation, abortError } from "../core/providers.js";

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

// Spawns a CLI, writes `input` to stdin, calls onLine for each stdout line.
// Resolves { code, stderr }; rejects on abort/timeout (after killing it).
export function runProcess({ bin, args, input, cwd, signal, timeoutMs = TIMEOUT_MS, onLine }) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
    const child = spawn(shell ? `"${bin}"` : bin, shell ? args.map(a => `"${a.replace(/"/g, '""')}"`) : args, {
      cwd, shell, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: process.env,
    });
    let stderr = "", buf = "", done = false, why = null;
    const kill = reason => {
      if (done || why) return;
      why = reason;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { if (child.exitCode === null) child.kill("SIGKILL"); } catch {} }, 2000).unref();
    };
    const timer = setTimeout(() => kill("timeout"), timeoutMs);
    const onAbort = () => kill("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) try { onLine(line); } catch (e) { kill(e); }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-4000); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", e => { done = true; clearTimeout(timer); reject(e); });
    child.on("close", code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (buf.trim()) try { onLine(buf.trim()); } catch {}
      if (why === "abort") return reject(abortError());
      if (why === "timeout") return reject(new Error(`The model took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`));
      if (why instanceof Error) return reject(why);
      resolve({ code, stderr });
    });
  });
}

const lastLine = s => (s || "").trim().split("\n").filter(Boolean).pop() || "";

// Claude Code: `claude -p` with stream-json output; token text arrives as
// stream_event/content_block_delta/text_delta, the final line is a `result`.
export async function claudeCodeStream(s, messages, { onToken, signal }) {
  const bin = s.bin || which("claude");
  if (!bin) throw new Error("Claude Code isn't installed (no `claude` on PATH). Install it from claude.com/claude-code, or pick another provider with `morse config`.");
  if (!validModel(s.model)) throw new Error(`Invalid model name "${s.model}"`);
  const { system, prompt } = flattenConversation(messages);
  const dir = await runDir();
  const sysFile = path.join(dir, "system.txt");
  await fs.writeFile(sysFile, system);
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
    "--system-prompt-file", sysFile,
    ...(s.model ? ["--model", s.model] : []),
  ];
  let text = "", result = null;
  try {
    const { code, stderr } = await runProcess({
      bin, args, input: prompt, cwd: path.join(dir, "cwd"), signal, timeoutMs: s.timeoutMs,
      onLine(line) {
        let ev;
        try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
          const t = ev.event.delta.text || "";
          if (t) { text += t; onToken?.(t); }
        } else if (ev.type === "result") result = ev;
      },
    });
    if (result && !result.is_error && (!result.subtype || result.subtype === "success")) {
      const full = typeof result.result === "string" ? result.result : text;
      // No partial messages (older CLI): emit whatever we didn't stream.
      if (full.startsWith(text) && full.length > text.length) { onToken?.(full.slice(text.length)); text = full; }
      return text || full;
    }
    const why = (typeof result?.result === "string" && result.result) || result?.errors?.join?.("; ") || result?.subtype || lastLine(stderr) || `exited with code ${code}`;
    throw new Error(`Claude Code: ${why}`);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Codex: `codex exec --json`, prompt on stdin. Handles both JSONL shapes:
//   new: {"type":"item.completed","item":{"type":"agent_message","text":...}}
//        (+ item.started/item.updated, and delta events when present)
//   old: {"msg":{"type":"agent_message_delta","delta":...}} / {"msg":{"type":"agent_message","message":...}}
export async function codexStream(s, messages, { onToken, signal }) {
  const bin = s.bin || which("codex");
  if (!bin) throw new Error("Codex isn't installed (no `codex` on PATH). Install it with `npm i -g @openai/codex`, or pick another provider with `morse config`.");
  if (!validModel(s.model)) throw new Error(`Invalid model name "${s.model}"`);
  const { system, prompt } = flattenConversation(messages);
  const dir = await runDir();
  const input = `<instructions>\n${system}\nAnswer directly in your reply. Do not run commands, read files, or edit files.\n</instructions>\n\n${prompt}`;
  const args = [
    "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", path.join(dir, "cwd"),
    "-c", "mcp_servers={}", "-c", "features.shell_tool=false", "-c", "features.web_search_request=false",
    ...(s.model ? ["-m", s.model] : []),
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

registerProvider("claude-code", claudeCodeStream);
registerProvider("codex", codexStream);
