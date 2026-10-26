// Local model servers Morse already knows how to talk to: anything that
// speaks the OpenAI chat API (core/providers.js, provider "local"). The
// addresses are the ones each server uses on this computer. A person can
// also type another address on this computer (choice "local").

export const LOCAL_RUNTIMES = [
  { id: "ollama", name: "Ollama", logo: "ollama", kind: "local", baseUrl: "http://127.0.0.1:11434", why: "a model running on this computer", install: "Install Ollama from ollama.com and start it" },
  { id: "lmstudio", name: "LM Studio", logo: "lmstudio", kind: "local", baseUrl: "http://127.0.0.1:1234", why: "a model running in LM Studio", install: "Start the local server in LM Studio" },
  { id: "llama", name: "llama.cpp", logo: "llamacpp", kind: "local", baseUrl: "http://127.0.0.1:8080", why: "a model running in llama.cpp", install: "Start the llama.cpp server" },
];

export const LOCAL_IDS = new Set([...LOCAL_RUNTIMES.map(r => r.id), "local"]);

export function runtimeById(id, runtimes = LOCAL_RUNTIMES) {
  return runtimes.find(r => r.id === id) || null;
}
