// The host side of user control, shared by the extension (extension/control-host.js),
// the desktop connector (daemon/control.js) and the demo playground. Each host
// supplies storage; this answers the runtime's control.* requests.
//
//   control.get       pause state here, and a safe-start suspect if any
//   control.boot      a page loaded (safe start); -> { pause, suspect, off }
//   control.off       { on } the off switch for this site in this tab
//   control.applied   a mod ran       control.alive   the page is still there
//   control.forgive   the person decided about a suspect
//   control.pause     { scope: "site" | "all", on, key? }
//   mods.preview      { source } -> { kind, mods, errors } (nothing is saved; the one install review uses it)
//   control.install   { mods, kind } -> the saved mods
//   control.exportAll -> { filename, content, count }

import { normalizeControl, isPaused, pauseInfo, setPause, safeKey, safeBoot, safeApplied, safeAlive, safeForgive, safeOff } from "./control.js";
import { exportBundle, backupFilename, parseImport, prepareInstall } from "./backup.js";

export const CONTROL_REQUESTS = new Set(["control.get", "control.boot", "control.applied", "control.alive", "control.forgive", "control.off", "control.pause", "mods.preview", "control.install", "control.exportAll"]);

// store: { load(), save(state), listMods(), putMods(mods), onPause?(pause),
//   atomic?(fn): the host's own lock, held from the read to the write }
export function controlHandler(store, clock = () => Date.now()) {
  let queue = Promise.resolve();
  // One read-modify-write at a time, so two tabs can't lose each other's update.
  const update = fn => {
    const work = async () => {
      const before = normalizeControl(await store.load());
      const pauseBefore = JSON.stringify(before.pause);
      const { state, result } = fn(before);
      // Safe start's pings write here several times per page load. Someone
      // else (`morse pause` / `morse resume` in a terminal, another host) may
      // have changed the pause meanwhile: an update that isn't about the
      // pause keeps the one on disk, so a ping can't undo a resume.
      const changed = pauseBefore !== JSON.stringify(state.pause);
      if (!changed) state.pause = normalizeControl(await store.load()).pause;
      await store.save(state);
      if (changed) store.onPause?.(state.pause);
      return result;
    };
    const run = queue.then(() => (store.atomic ? store.atomic(work) : work()));
    queue = run.catch(() => {});
    return run;
  };
  const read = async () => normalizeControl(await store.load());

  return async function handle(msg, where = { url: msg.url, app: msg.app || null }) {
    const sk = safeKey(where, msg.tab);
    switch (msg.type) {
      case "control.get": {
        const s = await read();
        return { pause: s.pause, info: pauseInfo(s, where), paused: isPaused(s, where), suspect: s.safe[sk]?.suspect || null };
      }
      case "control.boot":
        return update(s => {
          const { state, suspect, off } = safeBoot(s, sk, clock());
          return { state, result: { pause: state.pause, info: pauseInfo(state, where), suspect, off } };
        });
      case "control.applied":
        return update(s => ({ state: safeApplied(s, sk, msg.mod, clock()), result: true }));
      case "control.alive":
        return update(s => ({ state: safeAlive(s, sk, clock()), result: true }));
      case "control.forgive":
        return update(s => ({ state: safeForgive(s, sk), result: true }));
      case "control.off":
        return update(s => ({ state: safeOff(s, sk, !!msg.on), result: true }));
      case "control.pause":
        return update(s => {
          const state = msg.scope === "all" ? setPause(s, { all: !!msg.on }) : setPause(s, { key: msg.key || pauseInfo(s, where).key, on: !!msg.on });
          return { state, result: { pause: state.pause, info: pauseInfo(state, where) } };
        });
      case "mods.preview":
        return parseImport(msg.source);
      case "control.install": {
        const list = (Array.isArray(msg.mods) ? msg.mods : []).map(m => prepareInstall(m, { kind: msg.kind, where }));
        if (!list.length) throw new Error("Nothing to install in this.");
        await store.putMods(list);
        return list;
      }
      case "control.exportAll": {
        const mods = await store.listMods();
        return { filename: backupFilename(), content: JSON.stringify(exportBundle(mods), null, 2), count: mods.length };
      }
    }
    throw new Error(`Unknown request ${msg.type}`);
  };
}
