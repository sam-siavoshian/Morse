// Fake `claude` and `codex` executables for tests: they speak the real CLIs'
// output formats (Claude Code stream-json, Codex exec --json JSONL).
import { promises as fs } from "node:fs";
import path from "node:path";

// Each fake records its argv, cwd and stdin to $FAKE_LOG/<name>.json, and
// behaves according to $FAKE_MODE: ok | slow | fail | old (codex: old JSONL).
export const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
let input = "";
process.stdin.on("data", d => input += d).on("end", async () => {
  fs.writeFileSync(path.join(process.env.FAKE_LOG, "claude.json"), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input, pid: process.pid }));
  const out = o => process.stdout.write(JSON.stringify(o) + "\\n");
  const mode = process.env.FAKE_MODE || "ok";
  out({ type: "system", subtype: "init", tools: [], mcp_servers: [] });
  if (mode === "fail") { out({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login" }); process.exit(1); }
  const delta = text => out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
  delta("TITLE: Big\\n");
  if (mode === "slow") { await new Promise(r => setTimeout(r, 60000)); }
  delta("\`\`\`css\\nbutton{font-size:20px}\\n\`\`\`");
  out({ type: "assistant", message: { content: [{ type: "text", text: "TITLE: Big\\n\`\`\`css\\nbutton{font-size:20px}\\n\`\`\`" }] } });
  out({ type: "result", subtype: "success", is_error: false, result: "TITLE: Big\\n\`\`\`css\\nbutton{font-size:20px}\\n\`\`\`" });
});
`;

export const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
let input = "";
process.stdin.on("data", d => input += d).on("end", () => {
  fs.writeFileSync(path.join(process.env.FAKE_LOG, "codex.json"), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input }));
  const out = o => process.stdout.write(JSON.stringify(o) + "\\n");
  const mode = process.env.FAKE_MODE || "ok";
  if (mode === "old") {
    out({ id: "0", msg: { type: "task_started" } });
    out({ id: "0", msg: { type: "agent_message_delta", delta: "TITLE: Old" } });
    out({ id: "0", msg: { type: "agent_message_delta", delta: "\\n\`\`\`css\\na{}\\n\`\`\`" } });
    out({ id: "0", msg: { type: "agent_message", message: "TITLE: Old\\n\`\`\`css\\na{}\\n\`\`\`" } });
    out({ id: "0", msg: { type: "task_complete" } });
    return;
  }
  if (mode === "fail") { out({ type: "turn.failed", error: { message: "You've hit your usage limit." } }); process.exit(1); }
  out({ type: "thread.started", thread_id: "t" });
  out({ type: "turn.started" });
  out({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking about css" } });
  out({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "TITLE: New\\n\`\`\`css\\nb{}\\n\`\`\`" } });
  out({ type: "turn.completed", usage: {} });
});
`;

export async function installFakeClis(dir) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "claude"), FAKE_CLAUDE, { mode: 0o755 });
  await fs.writeFile(path.join(dir, "codex"), FAKE_CODEX, { mode: 0o755 });
}
