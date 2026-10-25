// First run and help, desktop side: the runtime's onboarding.get / .set /
// .open, served by the connector. Progress is ~/.morse/onboarding.json (shape
// in core/onboarding.js). There are no settings pages to open on the desktop,
// so "open" answers nothing and the bar says where to go (the Morse app).

import { promises as fs } from "node:fs";
import path from "node:path";
import { HOME, ensureHome, listMods } from "./store.js";
import { normalizeOnboarding, mergeOnboarding } from "../core/onboarding.js";

export const ONBOARDING_REQUESTS = new Set(["onboarding.get", "onboarding.set", "onboarding.open"]);
const FILE = () => path.join(HOME, "onboarding.json");

export async function loadOnboarding() {
  try { return normalizeOnboarding(JSON.parse(await fs.readFile(FILE(), "utf8"))); }
  catch {
    // People who used Morse before onboarding existed already know the ropes.
    const fresh = normalizeOnboarding({});
    try { if ((await listMods()).length) return mergeOnboarding(fresh, { coach: "done", tips: { saved: true } }); } catch {}
    return fresh;
  }
}

export async function saveOnboarding(patch) {
  const next = mergeOnboarding(await loadOnboarding(), patch);
  await ensureHome();
  await fs.writeFile(FILE(), JSON.stringify(next, null, 2));
  return next;
}

// "none" is what settings resolve to when nothing is set up; "demo" is a test fixture.
export const modelConnected = settings => !!settings?.provider && !["none", "demo"].includes(settings.provider);

// `settings` is the connector's resolved model settings.
export async function handleOnboarding(msg, { settings } = {}) {
  switch (msg.type) {
    case "onboarding.get":
      return { state: await loadOnboarding(), status: { mode: "desktop", model: { connected: modelConnected(settings), provider: settings?.provider || "" } } };
    case "onboarding.set":
      return saveOnboarding(msg.patch);
    case "onboarding.open":
      return null; // no settings page here: the bar says where to choose a model (ob.howModel: the Morse app)
  }
  throw new Error(`Unknown request ${msg.type}`);
}
