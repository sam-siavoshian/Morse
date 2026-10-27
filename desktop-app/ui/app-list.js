// Filtering never changes the source list or the sidebar's connection count.
export function filterApps(apps, query = "", connectedOnly = false) {
  const normalize = value => String(value).normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return apps.filter(app => (!connectedOnly || app.state === "connected") && words.every(word => normalize(app.name).includes(word)));
}

// Browsers need a separate route for their toolbar; native apps have no page
// route at all. Ordinary Electron/CEF apps already have their main action.
export function nativeAction(app, platform) {
  if (platform !== "darwin" || !app.running || ["opening", "disconnecting", "connecting"].includes(app.state)) return null;
  if (app.browser) return "browser";
  return app.engine === "native" ? "native" : null;
}
