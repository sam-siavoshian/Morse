// Providers: the real external services the bus calls. A provider turns a tap
// event into a payload by talking to something real — a lyrics source, a local
// Whisper server, an LLM endpoint. Keys, endpoints and rate limits are the
// daemon's (config/env), never the target app's.
//
// Integrity (the whole point of the Spotify-lyrics refusal in the UI): a
// provider that reports FACTS must fetch them from a real source and say so
// when there is none — it must not invent them. A provider that GENERATES must
// mark its payload `generated: true` so the render layer shows provenance and
// never passes generated text off as ground truth.
//
// `fetch(event, ctx)` gets `ctx.request` (injected, so transport is testable):
//   request(url, { method, headers, body }) -> parsed JSON (or text).

export function defineProvider(spec) {
  if (!spec?.name || typeof spec.match !== "function" || typeof spec.key !== "function" || typeof spec.fetch !== "function")
    throw new TypeError("a provider needs { name, match, key, fetch }");
  return { ttlMs: 60 * 60 * 1000, ...spec };
}

// Synced lyrics for the currently playing track, from a source the user
// configured. It never generates lyrics — if no source is set, it returns a
// clear no-source payload the UI shows (the honest version of the refusal).
//   endpoint: a URL that takes ?artist=&title= and returns { lines: [{ ms, text }] }
//             (e.g. a self-hosted LRCLIB mirror the user runs). apiKey optional.
export function lyricsProvider({ endpoint = null, apiKey = null } = {}) {
  return defineProvider({
    name: "lyrics",
    match: e => e?.type === "track" && !!(e.title && e.artist),
    key: e => `${e.artist}\u0000${e.title}`.toLowerCase(),
    async fetch(e, { request }) {
      if (!endpoint) {
        return { kind: "lyrics", status: "no-source", title: e.title, artist: e.artist,
          message: "No lyrics source is set. Point Morse at a lyrics provider you trust (a URL that returns timed lines); Morse won't invent lyrics." };
      }
      const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}artist=${encodeURIComponent(e.artist)}&title=${encodeURIComponent(e.title)}`;
      const data = await request(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
      const lines = Array.isArray(data?.lines) ? data.lines
        .filter(l => l && typeof l.text === "string")
        .map(l => ({ ms: Number(l.ms) || 0, text: l.text })) : [];
      return lines.length
        ? { kind: "lyrics", status: "ok", title: e.title, artist: e.artist, synced: lines.some(l => l.ms > 0), lines, source: endpoint, generated: false }
        : { kind: "lyrics", status: "not-found", title: e.title, artist: e.artist, source: endpoint,
            message: "This source has no lyrics for this track. Morse won't fill them in." };
    },
  });
}

// A template for any "look something up about the current state" provider: a
// factual one (generated:false, with a source) by default. Copy and set the
// real fetch. Kept so the pattern — real source, honest empty state — is the
// default, not an afterthought.
export function lookupProvider({ name, match, key, endpoint, map = x => x, apiKey = null }) {
  return defineProvider({
    name, match, key,
    async fetch(e, { request }) {
      if (!endpoint) return { kind: name, status: "no-source", message: `No source configured for ${name}.` };
      const data = await request(endpoint, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
      return { kind: name, status: "ok", source: endpoint, generated: false, ...map(data, e) };
    },
  });
}
