// The app's own renderer code, added to the shared Tunes UI: a Lyrics panel
// (a <webview>), a Mini Player button, an "about" line from the preload API,
// the menu's playback commands, and a command registry like the ones VS
// Code, Obsidian and Joplin have (Morse's app profile finds it and runs its
// commands: daemon/profile.js, tests/profile.test.js).
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

  // ---- the player and its commands
  const queue = await window.tunes.queue();
  const player = {
    queue, index: 0, liked: new Set(),
    get current() { return this.queue[this.index]; },
    show() {
      const [title, artist] = this.current;
      document.querySelector(".np b").textContent = title;
      document.querySelector(".np small").textContent = artist;
    },
    next() { this.index = (this.index + 1) % this.queue.length; this.show(); },
    previous() { this.index = (this.index - 1 + this.queue.length) % this.queue.length; this.show(); },
    // "Shuffle", the way this app has always done it: the same order every time.
    shuffle() { this.queue.sort((a, b) => a[0].localeCompare(b[0])); this.index = 0; this.show(); },
    setQueue(list) { this.queue = list; this.index = 0; this.show(); },
  };
  const commands = new Map();
  window.tunesApp = {
    player,
    commands: {
      register(id, name, run) { commands.set(id, { id, name, run }); },
      execute(id, ...args) { const c = commands.get(id); if (!c) return false; c.run(...args); return true; },
      listCommands() { return [...commands.values()].map(({ id, name }) => ({ id, name })); },
    },
  };
  const pp = document.querySelector('[data-testid="play-pause"]');
  const app = window.tunesApp.commands;
  app.register("player:play-pause", "Play or pause", () => pp.click());
  app.register("player:next", "Next song", () => player.next());
  app.register("player:previous", "Previous song", () => player.previous());
  app.register("player:shuffle", "Shuffle the queue", () => player.shuffle());
  app.register("library:like", "Like the song that is playing", () => { player.liked.add(player.current[0]); window.tunes.like(player.current[0]); });
  app.register("app:open-mini-player", "Open the mini player", () => window.tunes.openMiniPlayer());

  document.querySelector('[aria-label="Next"]').addEventListener("click", () => app.execute("player:next"));
  document.querySelector('[aria-label="Previous"]').addEventListener("click", () => app.execute("player:previous"));
  document.querySelector('[aria-label="Shuffle"]').addEventListener("click", () => app.execute("player:shuffle"));
  window.tunes.onCommand(cmd => { if (cmd === "play-pause") app.execute("player:play-pause"); else if (cmd === "next") app.execute("player:next"); });
})();
