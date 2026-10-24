// The demo sites (demo/serve.js) on free ports, and a way to show them to a
// browser at their usual addresses: the extension trusts the share page only
// on http://127.0.0.1:8787, so tests route those origins to the random ports
// instead of binding the fixed ones (which concurrent runs would fight over).
import { serveDemo } from "../../demo/serve.js";
import { serveBar } from "../../demo/bar-server.js";

export { serveBar };

// { sites: { parley, byte, tunes }, origin(site), close() }
export const startDemoServer = () => serveDemo({ base: 0 });

// Routes http://127.0.0.1:<8787|8788|8789>/… in a Playwright context to the
// demo server's real ports, passing the response (headers included) through.
export async function routeDemoOrigins(ctx, demo, fixed = { parley: 8787, byte: 8788, tunes: 8789, a11y: 8790 }) {
  for (const [site, port] of Object.entries(fixed)) {
    await ctx.route(`http://127.0.0.1:${port}/**`, async route => {
      const url = new URL(route.request().url());
      url.port = String(demo.sites[site]);
      try { await route.fulfill({ response: await route.fetch({ url: url.href }) }); }
      catch { await route.abort().catch(() => {}); }
    });
  }
}
