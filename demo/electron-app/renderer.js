// The app's own renderer code, added to the shared Tunes UI: a Lyrics panel
// (a <webview>), a Mini Player button, an "about" line from the preload API,
// and the menu's playback commands.
(async () => {
  const info = await window.tunes.info();

  const about = document.createElement("small");
  about.className = "about";
  about.textContent = `Tunes ${info.version} · Electron ${info.electron}`;
  about.style.cssText = "display:block;color:#6a6a6a;padding:18px 10px 0;font-size:11px";
  document.querySelector("nav").append(about);

  const lyrics = document.createElement("div");
  lyrics.className = "lyrics";
  lyrics.innerHTML = `<h2>Lyrics</h2>`;
  const view = document.createElement("webview");
  view.setAttribute("src", info.lyricsUrl);
  view.style.cssText = "display:flex;height:150px;border-radius:8px;overflow:hidden";
  lyrics.append(view);
  document.querySelector(".vw").append(lyrics);

  const miniBtn = document.createElement("button");
  miniBtn.setAttribute("aria-label", "Mini player");
  miniBtn.title = "Mini player (Ctrl+Shift+M)";
  miniBtn.textContent = "⧉";
  miniBtn.style.cssText = "background:none;border:0;color:#b3b3b3;font-size:16px;cursor:pointer";
  miniBtn.onclick = () => window.tunes.openMiniPlayer();
  document.querySelector(".vol").prepend(miniBtn);

  const pp = document.querySelector('[data-testid="play-pause"]');
  window.tunes.onCommand(cmd => { if (cmd === "play-pause") pp.click(); });
})();
