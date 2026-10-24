// A fake desktop app built from the preinstalled Chromium, shaped like real
// Electron apps: a main window with an app-owned frame in its own process
// (like a VS Code webview) and a third-party embed, a popup window opened with
// window.open, a page that reloads itself, and a second page to navigate to.
// It is started with --remote-debugging-port exactly as `morse launch` would,
// so it can be killed and restarted to test reattaching.
//
//   node demo/fake-app.js            serves it and opens it under $DISPLAY

import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px system-ui;margin:0;background:#101418;color:#e6edf3}header{padding:14px 20px;background:#161b22;border-bottom:1px solid #30363d}
main{padding:20px;display:grid;gap:14px}iframe{width:100%;height:120px;border:1px solid #30363d;border-radius:8px;background:#0d1117}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #30363d;background:#21262d;color:inherit}</style>${body}`;

export function serveFakeApp() {
  let port;
  const at = (host, p = "/") => `http://${host}:${port}${p}`;
  const routes = {
    "/": () => page("Inbox — Fake Mail", `<header><b>Fake Mail</b> · Inbox</header><main>
      <div class="msg" id="first">Welcome to Fake Mail</div>
      <button id="compose" onclick="window.open('/compose', 'compose', 'width=520,height=420')">Compose</button>
      <iframe id="preview" src="${at("files.fake.test", "/preview")}"></iframe>
      <iframe id="embed" src="${at("video.example.test", "/embed")}"></iframe></main>`),
    "/compose": () => page("Compose — Fake Mail", `<header><b>Compose</b></header><main><textarea rows=6></textarea></main>`),
    "/preview": () => page("Attachment preview", `<main><b>report.pdf</b> · preview</main>`),
    "/embed": () => page("Video", `<main>a third-party video player</main>`),
    "/settings": () => page("Settings — Fake Mail", `<header><b>Settings</b></header><main>Notifications: on</main>`),
    "/reloader": () => page("Reloader — Fake Mail", `<main id="n"></main><script>
      const n = Number(sessionStorage.getItem("loads") || 0) + 1; sessionStorage.setItem("loads", n);
      document.getElementById("n").textContent = "load " + n;
      if (n < 3) setTimeout(() => location.reload(), 700);</script>`),
  };
  const server = http.createServer((req, res) => {
    const r = routes[new URL(req.url, "http://x").pathname];
    if (!r) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(r());
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    port = server.address().port;
    resolve({ port, url: (p = "/") => at("app.fake.test", p), at, close: () => server.close() });
  }));
}

// Chromium flags that make the fake app behave like a packaged desktop app.
export function fakeAppArgs({ server, profile, headless = true, page = "/" }) {
  return [
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--no-proxy-server",
    "--host-resolver-rules=MAP *.fake.test 127.0.0.1, MAP *.example.test 127.0.0.1",
    // keep the app's own frame in its own renderer, like an Electron webview
    `--isolate-origins=${server.at("files.fake.test", "")}`,
    "--window-size=1100,720", "--force-device-scale-factor=1",
    ...(headless ? ["--headless=new"] : []),
    server.url(page),
  ];
}

export function launchFakeApp({ chrome, port, server, profile, headless = true }) {
  const proc = spawn(chrome, [`--remote-debugging-port=${port}`, ...fakeAppArgs({ server, profile, headless })], { stdio: "ignore" });
  proc.on("error", () => {});
  return proc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(import.meta.url)("playwright");
  const server = await serveFakeApp();
  const port = Number(process.env.PORT || 9444);
  launchFakeApp({ chrome: process.env.CHROME || chromium.executablePath(), port, server, profile: path.join(process.env.MORSE_HOME || "/tmp", "fake-app-profile"), headless: !process.env.DISPLAY });
  console.log(`Fake Mail on ${server.url()} · debugging port ${port}`);
}
