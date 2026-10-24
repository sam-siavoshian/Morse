# Ember — Local AI Chat

A private AI chat app that runs entirely on **your own machine**. Your conversations never
leave your computer. No accounts, no API keys, no cloud.

Ember talks to a local model through [Ollama](https://ollama.com). If no local model is
running, it drops into a built-in **demo mode** so the whole interface still works — you can
click around, start chats, and see exactly how it behaves before installing anything.

## Features

- 💬 **Streaming chat** against any local Ollama model, token by token
- 🔒 **Fully private** — requests go to `localhost:11434`, nothing is sent anywhere else
- 🧠 **Personas** — swap the system prompt (Default / Coder / Tutor / Terse) in one click
- 🔀 **Model picker** — auto-detects the models you have pulled
- 🗂 **Conversation history** — saved locally in your browser, nothing on a server
- 🟢 **Live status** — green when a local model is connected, amber in demo mode
- ⚡ **Zero build step** — three static files, open and go

## Run it

No dependencies, no build. Just serve the folder:

```bash
# any static server works
python3 -m http.server 8777
# then open http://localhost:8777
```

### Connect a real model (optional)

1. Install [Ollama](https://ollama.com)
2. Pull a model:
   ```bash
   ollama pull llama3.2
   ```
3. Make sure Ollama is running (`ollama serve`)

Ember detects it automatically — the status pill turns green and you're chatting with a model
running on your own machine.

## How it works

- `index.html` — layout
- `styles.css` — the UI
- `app.js` — conversation state, Ollama streaming, demo fallback, localStorage persistence

That's the whole thing. It's meant to be easy to read and easy to fork.

## Roadmap ideas

- Attach files / paste context
- Export a conversation to Markdown
- Custom personas you define yourself
- Keyboard-first command palette
- Package as a desktop app (Tauri)
