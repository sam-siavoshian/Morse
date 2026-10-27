// Every link target and the real pictures, in one place.
//
// Each page's buttons carry data-link="desktop" (and the like), and
// common.js points them here when the page loads. The href written in the
// HTML is the same placeholder, so the buttons work before the script runs.
//
// Paths are relative to site/ (the folder these pages are in).
// tests/site.test.js checks that every one of them resolves.

export const LINKS = {
  // "Download Morse": Morse Desktop. Until there is a download, it opens the
  // steps for the morse command. Then put the download page's address here.
  // Morse Desktop: the "preview" release, rebuilt from main on every push
  // (.github/workflows/preview.yml). The file names never change. common.js
  // points "desktop" buttons at this visitor's download when it can tell.
  desktop: "https://github.com/sam-siavoshian/RRAA/releases/tag/preview",
  desktopMac: "https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-mac-arm64.dmg",
  desktopMacIntel: "https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-mac-x64.dmg",
  desktopWindows: "https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-Setup.exe",
  desktopLinux: "https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-linux-x86_64.AppImage",
  github: "https://github.com/sam-siavoshian/RRAA",
  docs: "https://github.com/sam-siavoshian/RRAA/tree/HEAD/docs",
};

// "See it change": the big before and after pairs, in order. Each picture is a
// real screenshot of a real app or website; app is the name exactly as it
// shows on screen, and line is the few words under the picture. before and
// after must be the same size (width × height),
// since one slides over the other. To swap a pair, change it here only.
// No before-and-after pairs are currently featured.
export const SHOWCASE = [];

// The strip of real apps and websites, each a real screenshot with the Morse
// bar open, taken in October 2026 with Claude Code on Linux (sonnet or opus;
// docs/desktop.md, Tested on). app is the name exactly as it shows on screen;
// ask is what was asked; by is the model and how long it took to write.
export const REAL_APPS = [
  { app: "Visual Studio Code", kind: "Desktop app", ask: "add a big Pomodoro focus timer panel in the top right of the editor: a large 25:00 countdown with Start, Pause and Reset buttons, styled like VS Code's own widgets", by: "Claude Code (opus)", src: "shots/218-vscode-focus-timer.webp", width: 1200, height: 750, alt: "Visual Studio Code with a Focus timer panel at the top right, counting down from 25:00, with Start, Pause and Reset." },

  { app: "Obsidian", kind: "Desktop app", ask: "add a Pinned section at the top of the file list with Weekly plan and Reading list as big colored cards, each label vertically centered and fully visible; clicking a card opens that note", by: "Claude Code (opus)", src: "shots/220-obsidian-pinned-notes.webp", width: 1200, height: 750, alt: "Obsidian with a Pinned section above the file list: Weekly plan and Reading list as purple and orange cards." },
  { app: "Obsidian", kind: "Desktop app", ask: "add a big New daily note button at the top of the file list, with its label vertically centered and fully visible, that creates a note named with today's date, like 2026-10-24, and opens it", by: "Claude Code (opus)", src: "shots/221-obsidian-daily-note-button.webp", width: 1200, height: 750, alt: "Obsidian after clicking a new “+ New daily note” button: a note named 2026-10-24 is created and open." },

  { app: "Node.js docs", kind: "Website", ask: "add a floating table of contents on the right side that stays in view as I scroll and highlights the section I'm reading", by: "Claude Code (opus)", src: "shots/222-web-nodejs-floating-toc.webp", width: 1200, height: 750, alt: "The Node.js file system docs with a floating table of contents on the right, highlighting the section being read." },
  { app: "PyPI", kind: "Website", ask: "add a copy button to the top right corner of every code example", by: "Claude Code (sonnet), 12.7 seconds", src: "shots/182-web-pypi-copy-buttons.webp", width: 1280, height: 800, alt: "The requests page on PyPI with a new Copy button on the code example. The bar offers Save." },
  { app: "Docker Hub", kind: "Website", ask: "Explain this page", by: "Claude Code (sonnet), 6.4 seconds", src: "shots/313-real-explain.webp", width: 1280, height: 800, alt: "The nginx page on Docker Hub with numbered markers on the tabs, the tag list and the copy button, and the bar explaining each one." },

];

// The real icon of each app or website the page names, by its name as it
// shows on screen. Each file in icons/ is the app's own icon, taken from the
// installed app (the icon VS Code, VSCodium, Obsidian, Joplin and Logseq ship)
// or the site's own favicon, downloaded from it in October 2026, at 64 pixels
// or the size the site has. They are there only to name the app or site a
// picture or a mod is about (nominative use): they aren't Morse's, and Morse
// isn't affiliated with any of them. A name with no entry shows its first
// letter instead; that is only for sites whose icon couldn't be fetched.
export const APP_ICONS = {
  "Spotify": "icons/spotify.png",
  "YouTube": "icons/youtube-red.png",
  "Gmail": "icons/gmail.png",
  "GitHub": "icons/github.png",
  "macOS": "icons/os-mac.png",
  "Windows": "icons/os-windows.png",
  "Linux": "icons/os-linux.png",
  "VS Code": "icons/vscode.png",
  "Visual Studio Code": "icons/vscode.png",
  "VSCodium": "icons/vscodium.png",
  "Obsidian": "icons/obsidian.png",
  "Joplin": "icons/joplin.png",
  "Logseq": "icons/logseq.png",
  "PyPI": "icons/pypi.png",
  "Node.js docs": "icons/nodejs.png",
  "Go packages": "icons/go.png",
  "RubyGems": "icons/rubygems.png",
  "Docker Hub": "icons/docker.png",
  "GitLab": "icons/gitlab.png",
  "Ubuntu": "icons/ubuntu.png",
  "NuGet": "icons/nuget.png",
  "Packagist": "icons/packagist.png",
  "MetaCPAN": "icons/metacpan.png",
  "Claude": "icons/claude.png",
};
