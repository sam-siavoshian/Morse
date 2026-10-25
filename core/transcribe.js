// Speech to text for voice input, when the page can't use the Web Speech API
// (most Electron apps). The runtime records audio with MediaRecorder and sends
// it here as base64 (host message `transcribe { audio, mime }`).
//
// Providers:
//   openai   POST {baseUrl}/v1/audio/transcriptions with the user's key
//            (multipart, model gpt-4o-mini-transcribe)
//   whisper  a local binary on PATH: whisper-cli / whisper-cpp (whisper.cpp)
//            or whisper (openai-whisper). Nothing leaves the machine.
//
// transcribeOpenAI() is plain fetch + FormData, so the extension service
// worker can import this file; the whisper path loads node: modules lazily
// and only runs in Node.

export const OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // the OpenAI API's limit

const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac" };
export const extFor = mime => EXT[String(mime || "").split(";")[0].trim().toLowerCase()] || "webm";

export function decodeAudio(audio) {
  if (audio instanceof Uint8Array) return audio;
  const b64 = String(audio || "").replace(/^data:[^,]*,/, "");
  if (!b64) throw new Error("No audio was recorded.");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("That recording is too long to transcribe.");
  return bytes;
}

export async function transcribeOpenAI({ audio, mime = "audio/webm", apiKey, baseUrl = "https://api.openai.com", model = OPENAI_TRANSCRIBE_MODEL, language, prompt, signal }) {
  if (!apiKey) throw new Error("No OpenAI key for voice.");
  const bytes = decodeAudio(audio);
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([bytes], { type: String(mime).split(";")[0] }), `speech.${extFor(mime)}`);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  if (prompt) form.append("prompt", prompt);
  const url = `${String(baseUrl).replace(/\/$/, "").replace(/\/v1$/, "")}/v1/audio/transcriptions`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch {}
    const why = res.status === 401 ? "the OpenAI key was rejected" : `OpenAI returned ${res.status}`;
    throw new Error(`Transcription failed: ${why}${detail && res.status !== 401 ? ` (${detail.slice(0, 120)})` : ""}.`);
  }
  const body = await res.json();
  return { text: String(body.text || "").trim(), provider: "openai" };
}

// ---- local whisper (Node only)

const WHISPER_BINS = ["whisper-cli", "whisper-cpp", "whisper"];

export async function findWhisper(env = process.env) {
  const { promises: fs, constants } = await import("node:fs");
  const path = await import("node:path");
  if (env.MORSE_WHISPER_BIN) return env.MORSE_WHISPER_BIN;
  const dirs = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const name of WHISPER_BINS) for (const d of dirs) for (const x of exts) {
    const p = path.join(d, name + x);
    try { await fs.access(p, constants.X_OK); return p; } catch {}
  }
  return null;
}

// whisper.cpp needs a ggml model file; look where people usually put one.
export async function findWhisperModel(env = process.env) {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  if (env.MORSE_WHISPER_MODEL) return env.MORSE_WHISPER_MODEL;
  const home = env.MORSE_HOME || path.join(os.homedir(), ".morse");
  const dirs = [path.join(home, "models"), "/opt/homebrew/share/whisper-cpp", "/usr/local/share/whisper-cpp", "/usr/share/whisper-cpp", path.join(os.homedir(), ".cache", "whisper")];
  for (const d of dirs) {
    try {
      const files = (await fs.readdir(d)).filter(f => /^ggml-.*\.bin$/.test(f)).sort((a, b) => rank(a) - rank(b));
      if (files.length) return path.join(d, files[0]);
    } catch {}
  }
  return null;
}
const rank = f => ["base.en", "base", "small.en", "small", "tiny.en", "tiny"].findIndex(n => f === `ggml-${n}.bin`) >>> 0;

function run(cmd, args, { signal, timeoutMs = 120000 } = {}) {
  return import("node:child_process").then(({ spawn }) => new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    const kill = () => p.kill("SIGKILL");
    const t = setTimeout(kill, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    p.on("error", e => { clearTimeout(t); reject(e); });
    p.on("close", code => {
      clearTimeout(t);
      if (signal?.aborted) reject(new Error("aborted"));
      else if (code === 0) resolve(out);
      else reject(new Error(`${cmd.split(/[\\/]/).pop()} exited with ${code}: ${err.trim().split("\n").pop() || "no output"}`));
    });
  }));
}

export async function transcribeWhisper({ audio, mime = "audio/webm", bin, model, language, signal, env = process.env }) {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  bin = bin || (await findWhisper(env));
  if (!bin) throw new Error("whisper is not installed.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morse-voice-"));
  try {
    const input = path.join(dir, `speech.${extFor(mime)}`);
    await fs.writeFile(input, decodeAudio(audio));
    const name = path.basename(bin).replace(/\.(exe|cmd|bat)$/i, "");
    let text;
    if (name === "whisper") {
      // openai-whisper (Python): reads any format through ffmpeg, writes <dir>/speech.txt
      const args = [input, "--model", model && !/[\\/]/.test(model) ? model : "base", "--output_format", "txt", "--output_dir", dir, "--fp16", "False", "--verbose", "False", "--beam_size", "1", "--best_of", "1"]; // speed: greedy, a few words don't need a beam search
      if (language) args.push("--language", language);
      await run(bin, args, { signal });
      text = await fs.readFile(path.join(dir, "speech.txt"), "utf8");
    } else {
      // whisper.cpp: wants 16 kHz mono WAV and a ggml model file
      const modelPath = model && /[\\/]/.test(model) ? model : await findWhisperModel(env);
      if (!modelPath) throw new Error("whisper.cpp needs a model: put a ggml-*.bin in ~/.morse/models or set MORSE_WHISPER_MODEL.");
      let wav = input;
      if (extFor(mime) !== "wav") {
        wav = path.join(dir, "speech.wav");
        try { await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { signal }); }
        catch (e) { throw new Error(/ENOENT/.test(e.message) ? "whisper.cpp needs ffmpeg on your PATH to read browser audio." : e.message); }
      }
      // speed: greedy decoding on every core (the default beam search is several times slower for a sentence)
      const threads = String(Math.max(1, Math.min(8, os.availableParallelism?.() || os.cpus().length || 4)));
      text = await run(bin, ["-m", modelPath, "-f", wav, "-nt", "-np", "-l", language || "auto", "-t", threads, "-bs", "1", "-bo", "1"], { signal });
    }
    return { text: clean(text), provider: "whisper" };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Whisper marks silence and noise with bracketed tags; drop them.
const clean = t => String(t || "").replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE|inaudible)\]|\((silence|music|noise)\)/gi, " ").replace(/\s+/g, " ").trim();

// ---- choosing a provider

// opts: { openaiKey, openaiBaseUrl, whisperBin, whisperModel, provider: "auto"|"openai"|"whisper", env }
export async function voiceStatus(opts = {}) {
  const env = opts.env || (typeof process !== "undefined" ? process.env : {});
  const whisper = opts.provider === "openai" ? null : opts.whisperBin || (typeof process !== "undefined" && process.versions?.node ? await findWhisper(env) : null);
  const openai = opts.provider === "whisper" ? false : !!opts.openaiKey;
  const providers = [];
  if (openai) providers.push("openai");
  if (whisper) providers.push("whisper");
  if (opts.provider === "whisper") providers.reverse();
  const label = { openai: `OpenAI ${OPENAI_TRANSCRIBE_MODEL}`, whisper: `whisper on this computer` }[providers[0]] || "";
  return {
    transcribe: providers.length > 0,
    provider: providers[0] || null,
    providers,
    label,
    hint: providers.length ? "" : "To use voice, set OPENAI_API_KEY or install whisper-cli (whisper.cpp)",
  };
}

// Tries the configured providers in order; an OpenAI outage falls back to a
// local whisper when there is one.
export async function transcribe({ audio, mime, signal, ...opts }) {
  const st = await voiceStatus(opts);
  if (!st.transcribe) throw new Error(st.hint);
  let last;
  for (const p of st.providers) {
    try {
      if (p === "openai") return await transcribeOpenAI({ audio, mime, apiKey: opts.openaiKey, baseUrl: opts.openaiBaseUrl, model: opts.openaiModel, language: opts.language, signal });
      return await transcribeWhisper({ audio, mime, bin: opts.whisperBin, model: opts.whisperModel, language: opts.language, signal, env: opts.env });
    } catch (e) {
      last = e;
      if (signal?.aborted || /rejected/.test(e.message)) throw e;
    }
  }
  throw last;
}
