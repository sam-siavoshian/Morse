// `morse doctor` says when a newer morse-cli is on npm.
//
// One GET to the npm registry (https://registry.npmjs.org/morse-cli/latest),
// with no cookies and nothing about the person, at most once a day: the answer
// is kept in ~/.morse/update-check.json. Only `morse doctor` asks; nothing else
// in Morse calls this. MORSE_NO_UPDATE_CHECK=1 turns it off (no request, no
// file). MORSE_UPDATE_REGISTRY points it at another registry (tests use a fake
// one). docs/privacy.md says the same; keep the two in step.

import { promises as fs } from "node:fs";
import path from "node:path";
import { HOME } from "./store.js";

export const PACKAGE = "morse-cli";
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
export const DAY = 24 * 60 * 60 * 1000;

const parse = v => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(String(v || "").trim());
  return m && { n: [+m[1], +m[2], +m[3]], pre: m[4] || "" };
};

// True when `latest` is a newer release than `current`. npm's "latest" is
// never a pre-release unless someone tags it so; a pre-release only counts as
// newer than a lower version.
export function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i];
  return !a.pre && !!b.pre;
}

export const updateCheckOff = (env = process.env) => /^(1|true|yes)$/i.test(String(env.MORSE_NO_UPDATE_CHECK || ""));

// { state: "off" | "newer" | "current" | "unpublished" (not on npm) | "unknown" (no answer), latest?, cached?, error? }
export async function checkForUpdate(current, {
  env = process.env,
  home = HOME,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
} = {}) {
  if (updateCheckOff(env)) return { state: "off" };
  const registry = String(env.MORSE_UPDATE_REGISTRY || DEFAULT_REGISTRY).replace(/\/+$/, "");
  const file = path.join(home, "update-check.json");
  const verdict = (latest, cached) => ({ state: !latest ? "unpublished" : isNewer(latest, current) ? "newer" : "current", latest: latest || undefined, cached });

  let saved = null;
  try { saved = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
  // A day old at most, from the same registry, and not from the future (a clock that jumped back).
  if (saved && saved.registry === registry && typeof saved.checkedAt === "number" && saved.checkedAt <= now && now - saved.checkedAt < DAY) {
    return verdict(saved.latest, true);
  }

  let latest = null;
  try {
    const res = await fetchImpl(`${registry}/${PACKAGE}/latest`, {
      headers: { accept: "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 404: not on npm (yet). Nothing newer; ask again tomorrow.
    if (res.status !== 404) {
      if (!res.ok) return { state: "unknown", error: `error ${res.status}` };
      const version = (await res.json())?.version;
      if (!parse(version)) return { state: "unknown", error: "the registry's answer has no version" };
      latest = String(version).trim().replace(/^v/, "");
    }
  } catch (e) {
    // Offline or no answer: say so, and try again next time (nothing is saved).
    return { state: "unknown", error: e?.name === "TimeoutError" ? "no answer" : e?.cause?.code || e?.message || String(e) };
  }
  try {
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await fs.writeFile(file, JSON.stringify({ checkedAt: now, registry, latest }) + "\n", { mode: 0o600 });
  } catch {} // a read-only home only means asking again next time
  return verdict(latest, false);
}
