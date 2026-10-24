/* Ember — a local AI chat app.
 * Talks to a local model via Ollama (http://localhost:11434).
 * Falls back to a built-in demo responder when no local model is reachable,
 * so the UI is fully usable without anything installed. */

const OLLAMA = "http://localhost:11434";

const PERSONAS = {
  default: { name: "Default", prompt: "You are a helpful, concise assistant." },
  coder:   { name: "Coder",   prompt: "You are a senior software engineer. Give precise, idiomatic code and short explanations." },
  tutor:   { name: "Tutor",   prompt: "You are a patient tutor. Explain step by step with simple examples." },
  brief:   { name: "Terse",   prompt: "Answer in as few words as possible. No fluff." },
};

const state = {
  convos: load("ember.convos", []),
  activeId: null,
  model: load("ember.model", "llama3.2"),
  persona: load("ember.persona", "default"),
  models: [],
  online: false,
  streaming: false,
};

/* ---------- persistence ---------- */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function persist() { save("ember.convos", state.convos); save("ember.model", state.model); save("ember.persona", state.persona); }

function uid() { return Math.random().toString(36).slice(2, 10); }

/* ---------- conversation model ---------- */
function activeConvo() { return state.convos.find(c => c.id === state.activeId) || null; }

function newConvo() {
  const c = { id: uid(), title: "New chat", messages: [], created: Date.now() };
  state.convos.unshift(c);
  state.activeId = c.id;
  persist();
  render();
  document.getElementById("composer-input")?.focus();
}

function selectConvo(id) { state.activeId = id; render(); }

function titleFrom(text) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 38 ? t.slice(0, 38) + "…" : t || "New chat";
}

/* ---------- backend detection ---------- */
async function detectBackend() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    state.models = (data.models || []).map(m => m.name);
    state.online = true;
    if (state.models.length && !state.models.includes(state.model)) state.model = state.models[0];
  } catch {
    state.online = false;
    state.models = [];
  }
  renderStatus();
  renderModelPicker();
}

/* ---------- sending ---------- */
async function send(text) {
  if (state.streaming) return;
  text = text.trim();
  if (!text) return;

  let convo = activeConvo();
  if (!convo) { newConvo(); convo = activeConvo(); }

  convo.messages.push({ role: "user", content: text });
  if (convo.title === "New chat") convo.title = titleFrom(text);
  const assistant = { role: "assistant", content: "" };
  convo.messages.push(assistant);
  state.streaming = true;
  persist();
  render();

  const sys = PERSONAS[state.persona]?.prompt || PERSONAS.default.prompt;
  const history = [{ role: "system", content: sys }, ...convo.messages.filter(m => m.content || m.role === "user").slice(0, -1)];

  try {
    if (state.online) await streamOllama(history, assistant);
    else await streamDemo(history, assistant);
  } catch (e) {
    assistant.content += `\n\n_(error: ${e.message})_`;
  } finally {
    state.streaming = false;
    persist();
    render();
  }
}

async function streamOllama(messages, assistant) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: state.model, messages, stream: true }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) { assistant.content += obj.message.content; renderChat(); }
      } catch {}
    }
  }
}

/* Demo responder: simulates streaming so the app works with no model installed. */
async function streamDemo(messages, assistant) {
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
  const reply = demoReply(lastUser);
  for (const tok of reply.match(/\S+\s*/g) || []) {
    assistant.content += tok;
    renderChat();
    await sleep(18 + Math.min(40, tok.length * 6));
  }
}

function demoReply(q) {
  const lower = q.toLowerCase();
  if (/hello|hi|hey/.test(lower))
    return "Hey! I'm running in demo mode right now — no local model is connected yet.\n\nTo get real answers, install Ollama and pull a model:\n\n`ollama pull llama3.2`\n\nOnce it's running on localhost:11434, Ember will detect it automatically and the status pill up top will turn green.";
  if (/code|function|bug|python|javascript|js/.test(lower))
    return "Here's the shape of an answer you'd get with a real model connected:\n\n```python\ndef greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n```\n\nRight now I'm the built-in demo responder. Connect a local model via Ollama to get genuine code help.";
  if (/what|who|how|why|explain/.test(lower))
    return "Good question. In demo mode I can't actually reason about it — I'm a small built-in stub so the interface is usable before you connect a model.\n\nStart your local model (e.g. `ollama serve` with a model pulled) and ask again — the reply will come straight from your machine, fully private.";
  return "You're talking to Ember's demo responder — the UI works, but there's no model behind it yet.\n\nConnect a local model through Ollama (`ollama pull llama3.2`) and I'll stream real answers from your own machine. Nothing leaves your computer.";
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- rendering ---------- */
function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function renderContent(text) {
  // minimal markdown: fenced code, inline code, paragraphs
  const parts = text.split(/```/);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const body = part.replace(/^[a-z]*\n/i, "");
      html += `<pre><code>${escapeHtml(body)}</code></pre>`;
    } else {
      const esc = escapeHtml(part).replace(/`([^`]+)`/g, "<code>$1</code>");
      html += esc.split(/\n{2,}/).filter(Boolean).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
    }
  });
  return html || "<p></p>";
}

function renderChat() {
  const convo = activeConvo();
  const chat = document.getElementById("chat");
  if (!chat) return;
  if (!convo || convo.messages.length === 0) {
    chat.innerHTML = emptyState();
    bindSuggestions();
    return;
  }
  chat.innerHTML = `<div class="chat-inner">${convo.messages.map((m, idx) => {
    const isLast = idx === convo.messages.length - 1;
    const cursor = (state.streaming && isLast && m.role === "assistant") ? '<span class="cursor"></span>' : "";
    return `<div class="msg ${m.role}">
      <div class="avatar">${m.role === "user" ? "U" : "✦"}</div>
      <div class="body">
        <div class="role">${m.role === "user" ? "You" : "Ember"}</div>
        <div class="content">${renderContent(m.content)}${cursor}</div>
      </div>
    </div>`;
  }).join("")}</div>`;
  chat.scrollTop = chat.scrollHeight;
}

function emptyState() {
  return `<div class="empty">
    <div class="orb">✦</div>
    <h2>Ember</h2>
    <p>A private AI chat that runs on your own machine. Your conversations never leave your computer.</p>
    <div class="suggestions">
      <div class="suggestion" data-q="Explain how async/await works in JavaScript">Explain async/await</div>
      <div class="suggestion" data-q="Write a Python function to deduplicate a list">Dedup a list in Python</div>
      <div class="suggestion" data-q="Give me 5 ideas for a weekend project">Weekend project ideas</div>
      <div class="suggestion" data-q="Summarize the plot of a heist movie in 3 lines">Summarize a heist movie</div>
    </div>
  </div>`;
}

function bindSuggestions() {
  document.querySelectorAll(".suggestion").forEach(el => {
    el.onclick = () => send(el.dataset.q);
  });
}

function renderSidebar() {
  const list = document.getElementById("convos");
  if (!list) return;
  if (state.convos.length === 0) { list.innerHTML = `<div class="section-label">No chats yet</div>`; return; }
  list.innerHTML = `<div class="section-label">Chats</div>` + state.convos.map(c =>
    `<div class="convo ${c.id === state.activeId ? "active" : ""}" data-id="${c.id}">
      <span class="dot"></span><span>${escapeHtml(c.title)}</span>
    </div>`).join("");
  list.querySelectorAll(".convo").forEach(el => { el.onclick = () => selectConvo(el.dataset.id); });
}

function renderStatus() {
  const pill = document.getElementById("status");
  if (!pill) return;
  if (state.online) {
    pill.className = "status-pill ok";
    pill.innerHTML = `<span class="led"></span> Local model connected`;
  } else {
    pill.className = "status-pill warn";
    pill.innerHTML = `<span class="led"></span> Demo mode · start Ollama`;
  }
}

function renderModelPicker() {
  const sel = document.getElementById("model-select");
  if (!sel) return;
  const opts = state.online && state.models.length ? state.models : [state.model, "llama3.2", "qwen2.5-coder", "mistral", "phi3"];
  const uniq = [...new Set(opts)];
  sel.innerHTML = uniq.map(m => `<option value="${m}" ${m === state.model ? "selected" : ""}>${m}</option>`).join("");
  sel.onchange = () => { state.model = sel.value; persist(); };
}

function renderPersona() {
  const sel = document.getElementById("persona-select");
  if (!sel) return;
  sel.innerHTML = Object.entries(PERSONAS).map(([k, v]) => `<option value="${k}" ${k === state.persona ? "selected" : ""}>${v.name}</option>`).join("");
  sel.onchange = () => { state.persona = sel.value; persist(); };
}

function render() {
  renderSidebar();
  renderChat();
  renderModelPicker();
  renderPersona();
  const btn = document.getElementById("send-btn");
  if (btn) btn.disabled = state.streaming;
}

/* ---------- composer ---------- */
function setupComposer() {
  const ta = document.getElementById("composer-input");
  const btn = document.getElementById("send-btn");
  const submit = () => {
    const v = ta.value;
    ta.value = "";
    ta.style.height = "auto";
    send(v);
  };
  btn.onclick = submit;
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  });
}

/* ---------- boot ---------- */
function boot() {
  document.getElementById("new-chat").onclick = newConvo;
  setupComposer();
  if (state.convos.length) state.activeId = state.convos[0].id;
  render();
  renderStatus();
  detectBackend();
  setInterval(detectBackend, 8000);
}

document.addEventListener("DOMContentLoaded", boot);
