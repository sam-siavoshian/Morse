// Who holds detached DOM? Takes a heap snapshot of a page (CDP) and prints,
// for the detached elements, the shortest paths from a GC root, grouped. The
// tool used to find the leaks in docs/perf/soak.md.
//   import { detachedRetainers } from "./retainers.js";
//   console.log(await detachedRetainers(cdpSend, cdpOn));
export async function takeSnapshot(send, on) {
  let chunks = [];
  const off = on("HeapProfiler.addHeapSnapshotChunk", p => chunks.push(p.chunk));
  await send("HeapProfiler.enable");
  await send("HeapProfiler.collectGarbage");
  await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
  off?.();
  const snap = JSON.parse(chunks.join(""));
  chunks = null;
  return snap;
}

// Heap snapshot ids of the detached elements JS in one world still holds
// (Runtime.queryObjects finds them; the snapshot then says who holds them).
export async function detachedIds(send, contextId, max = 60) {
  await send("HeapProfiler.enable");
  const proto = await send("Runtime.evaluate", { expression: "Element.prototype", contextId, objectGroup: "ret" });
  const all = await send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "ret" });
  const det = await send("Runtime.callFunctionOn", { objectId: all.objects.objectId, objectGroup: "ret",
    functionDeclaration: `function () { const out = []; for (const e of this) try { if (!e.isConnected) out.push(e); } catch {} return out.slice(0, ${max}); }` });
  const props = await send("Runtime.getProperties", { objectId: det.result.objectId, ownProperties: true });
  const ids = new Set();
  for (const p of props.result) if (/^\d+$/.test(p.name) && p.value?.objectId) ids.add(+(await send("HeapProfiler.getHeapObjectId", { objectId: p.value.objectId })).heapSnapshotObjectId);
  await send("Runtime.releaseObjectGroup", { objectGroup: "ret" });
  return ids;
}

export function analyze(snap, { ids = null, match = /^Detached /, byName = null, max = 12, depth = 40 } = {}) {
  const m = snap.snapshot.meta;
  const NF = m.node_fields.length, EF = m.edge_fields.length;
  const nType = m.node_fields.indexOf("type"), nName = m.node_fields.indexOf("name"), nEdges = m.node_fields.indexOf("edge_count");
  const eType = m.edge_fields.indexOf("type"), eName = m.edge_fields.indexOf("name_or_index"), eTo = m.edge_fields.indexOf("to_node");
  const nodeTypes = m.node_types[nType], edgeTypes = m.edge_types[eType];
  const { nodes, edges, strings } = snap;
  const count = nodes.length / NF;
  const first = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { first[i] = e; e += nodes[i * NF + nEdges] * EF; }
  first[count] = edges.length;
  // reverse edges (skip weak ones)
  const rev = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i++) {
    for (let e = first[i]; e < first[i + 1]; e += EF) {
      const t = edgeTypes[edges[e + eType]];
      if (t === "weak" || t === "shortcut") continue;
      rev[edges[e + eTo] / NF].push([i, e]);
    }
  }
  const name = i => strings[nodes[i * NF + nName]];
  const type = i => nodeTypes[nodes[i * NF + nType]];
  const edgeLabel = e => { const t = edgeTypes[edges[e + eType]]; const n = edges[e + eName]; return t === "element" || t === "hidden" ? `[${n}]` : strings[n]; };
  // Newer Chromium marks detached DOM in a node field; older ones name it "Detached …".
  const nDet = m.node_fields.indexOf("detachedness"), nId = m.node_fields.indexOf("id");
  const targets = [];
  for (let i = 0; i < count; i++) {
    if (byName ? byName.test(name(i)) : ids ? ids.has(nodes[i * NF + nId]) : nDet >= 0 ? nodes[i * NF + nDet] === 2 && /^(HTML|SVG)\w*Element|^<|Element$/.test(name(i)) && type(i) !== "native" : match.test(name(i))) targets.push(i);
  }
  // For each detached element whose parent isn't also detached-matching: a path to the root (node 0).
  const groups = new Map();
  for (const t of targets.slice(0, 400)) {
    const seen = new Map([[t, null]]);
    let frontier = [t], found = null;
    for (let d = 0; d < depth && frontier.length && found == null; d++) {
      const next = [];
      for (const n of frontier) {
        for (const [from, e] of rev[n]) {
          if (seen.has(from)) continue;
          seen.set(from, [n, e]);
          if (from === 0 || type(from) === "synthetic") { found = from; break; }
          next.push(from);
        }
        if (found != null) break;
      }
      frontier = next;
    }
    if (found == null) continue;
    const path = [];
    for (let n = found; n !== t;) { const [to, e] = seen.get(n); path.push(`${name(n).slice(0, 40)} -${edgeLabel(e)}->`); n = to; }
    path.push(name(t));
    const key = (path.length > 12 ? [...path.slice(0, 5), "…", ...path.slice(-7)] : path).join(" ");
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const det = new Map();
  if (nDet >= 0) for (let i = 0; i < count; i++) if (nodes[i * NF + nDet] === 2) { const k = `${type(i)}:${name(i).slice(0, 30)}`; det.set(k, (det.get(k) || 0) + 1); }
  return { fields: m.node_fields, kinds: [...det].sort((a, b) => b[1] - a[1]).slice(0, 15), detached: targets.length, paths: [...groups].sort((a, b) => b[1] - a[1]).slice(0, max) };
}

// For each JS world of the probe's page (lib.js PageProbe): the detached
// elements it holds, and the paths that hold them.
export async function printRetainers(probe, log = console.log) {
  const frame = await probe.topFrame();
  for (const c of [...probe.contexts.values()].filter(c => c.auxData?.frameId === frame && !/^__playwright/.test(c.name))) {
    const ids = await detachedIds(probe.send, c.id).catch(e => (log(e.message), new Set()));
    if (!ids.size) continue;
    const r = analyze(await takeSnapshot(probe.send, (e, f) => { probe.cdp.on(e, f); return () => probe.cdp.off(e, f); }), { ids });
    log(`world ${c.name || "page"}: ${ids.size} detached`);
    for (const [path, n] of r.paths) log(`  ${n}x ${path}`);
  }
}
