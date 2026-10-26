// Every link target, the film and the real pictures, in one place.
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

// The film under the headline. To swap in a new video, put the files in
// docs/launch/ (or site/) and change them here. loop is the muted autoplay
// copy (1280 wide, WebM and MP4, about 1 MB, made from the full file with
// ffmpeg); mp4 is the full-quality file with sound the press plays. width
// and height set the frame's shape before it loads. caption is the line under
// it, label is what a screen reader says, and strip is the short line above it.
export const DEMO_VIDEO = {
  mp4: "../docs/launch/morse-opus-open-16x9.mp4",
  loop: { webm: "../docs/launch/morse-opus-open-web.webm", mp4: "../docs/launch/morse-opus-open-web.mp4" },
  poster: "../docs/launch/morse-opus-open-poster.webp",
  width: 1920,
  height: 1080,
  label: "Morse on The Daily Byte, then Obsidian, the Mods list, the shortcut and the update window, 33 seconds",
  strip: "The finished page first, then how it got there",
  caption: "33 seconds. Opens on the finished page: the headline is “A quieter front page”, the ads and the popup are gone, and the page is dark. Then those edits, Obsidian in light mode, the Mods list, the shortcut and the update window. No model was called. The update percent is the window playing, not a download.",
};

// "See it change": the big before and after pairs, in order. Each picture is a
// real screenshot of a real app or website; app is the name exactly as it
// shows on screen. before and after must be the same size (width × height),
// since one slides over the other. To swap a pair, change it here only.
export const SHOWCASE = [
  {
    app: "Visual Studio Code",
    kind: "Desktop app, on Linux",
    note: "Microsoft’s Visual Studio Code 1.143. CSS only; quit and opened again, it was back.",
    ask: "using only CSS, make VS Code look like a classic Windows 95 app: silver gray 3D bevelled panels, tabs and buttons, a navy blue title bar with white bold text, Tahoma for the menus and panels, black text on every gray panel and tab, white text on navy selections, and a plain white editor with dark text; the current line, the active tab and the section header rows should be light gray with black text; keep VS Code's own icons and the editor's monospace font",
    by: "Claude Code (opus), 31 seconds",
    before: "shots/210-vscode-windows-95-before.webp",
    after: "shots/211-vscode-windows-95-after.webp",
    width: 1200, height: 750,
    alt: {
      before: "Visual Studio Code with its usual dark theme, a JavaScript file open and the file list on the left.",
      after: "The same VS Code window as a Windows 95 app: navy title bar, silver gray bevelled panels and buttons, a white editor with black code.",
    },
  },
  {
    app: "Obsidian",
    kind: "Desktop app, on Linux",
    note: "A real vault. Quit and opened again, it was back.",
    ask: "make Obsidian look like an old typewriter: cream paper background with a subtle paper texture, a typewriter font like Courier for everything, dark brown ink for the text, and paper-colored side panels with thin ruled lines",
    by: "Claude Code (opus), 15 seconds",
    before: "shots/212-obsidian-typewriter-before.webp",
    after: "shots/213-obsidian-typewriter-after.webp",
    width: 1200, height: 750,
    alt: {
      before: "Obsidian with its usual light theme, the note Weekly plan open beside the file list.",
      after: "The same note on cream paper in a typewriter font with dark brown ink, and ruled lines down the file list.",
    },
  },
  {
    app: "Visual Studio Code",
    kind: "Desktop app, on Linux",
    note: "Microsoft’s Visual Studio Code 1.143. The picture is after pressing Ctrl+Alt+P for real.",
    ask: "when I press Ctrl+Alt+P, switch to a presentation mode: hide the sidebar and the activity bar so the code fills the whole window, and make the code twice as big so people at the back can read it; pressing it again goes back",
    by: "Claude Code (opus), 24 seconds",
    before: "shots/214-vscode-presentation-shortcut-before.webp",
    after: "shots/215-vscode-presentation-shortcut-after.webp",
    width: 1200, height: 750,
    alt: {
      before: "Visual Studio Code with the file list, the activity bar and a JavaScript file in its usual small type.",
      after: "After Ctrl+Alt+P: no sidebar or activity bar, the code twice as big across the whole window, and a note saying how to exit.",
    },
  },
  {
    app: "Docker Hub",
    kind: "Website, in Chrome",
    note: "hub.docker.com/_/nginx, the live site, after a reload.",
    ask: "hide everything on this page except the README, and center it in a comfortable reading column",
    by: "Claude Code (opus), 9 seconds",
    before: "shots/216-web-dockerhub-readme-only-before.webp",
    after: "shots/217-web-dockerhub-readme-only-after.webp",
    width: 1200, height: 750,
    alt: {
      before: "The nginx page on Docker Hub: blue header, image details, tabs, and the tag summary column beside the README.",
      after: "The same page with only the README left, centered in one reading column: no header, tabs or side column.",
    },
  },
];

// The strip of real apps and websites, each a real screenshot with the Morse
// bar open, taken in October 2026 with Claude Code on Linux (sonnet or opus;
// docs/desktop.md, Tested on). app is the name exactly as it shows on screen;
// ask is what was asked; by is the model and how long it took to write.
export const REAL_APPS = [
  { app: "Visual Studio Code", kind: "Desktop app", ask: "add a big Pomodoro focus timer panel in the top right of the editor: a large 25:00 countdown with Start, Pause and Reset buttons, styled like VS Code's own widgets", by: "Claude Code (opus)", src: "shots/218-vscode-focus-timer.webp", width: 1200, height: 750, alt: "Visual Studio Code with a Focus timer panel at the top right, counting down from 25:00, with Start, Pause and Reset." },
  { app: "VSCodium", kind: "Desktop app", ask: "give the editor a synthwave look: deep purple background, neon pink and cyan text, and a glowing purple activity bar", by: "Claude Code (opus), 22.9 seconds", src: "shots/327-vscodium-synthwave.webp", width: 1200, height: 750, alt: "VSCodium with a deep purple editor, pink and cyan code and a purple activity bar. The bar offers Save." },
  { app: "Obsidian", kind: "Desktop app", ask: "add a Pinned section at the top of the file list with Weekly plan and Reading list as big colored cards, each label vertically centered and fully visible; clicking a card opens that note", by: "Claude Code (opus)", src: "shots/220-obsidian-pinned-notes.webp", width: 1200, height: 750, alt: "Obsidian with a Pinned section above the file list: Weekly plan and Reading list as purple and orange cards." },
  { app: "Obsidian", kind: "Desktop app", ask: "add a big New daily note button at the top of the file list, with its label vertically centered and fully visible, that creates a note named with today's date, like 2026-10-24, and opens it", by: "Claude Code (opus)", src: "shots/221-obsidian-daily-note-button.webp", width: 1200, height: 750, alt: "Obsidian after clicking a new “+ New daily note” button: a note named 2026-10-24 is created and open." },
  { app: "Logseq", kind: "Desktop app", ask: "make the journal look like a lined paper notebook: cream ruled lines behind the text, a handwriting style font, and much bigger page titles", by: "Claude Code (sonnet), 6.4 seconds", src: "shots/329-logseq-notebook.webp", width: 980, height: 700, alt: "Logseq’s journal on ruled cream paper with a red margin line and a big serif date. The bar offers Save." },
  { app: "Node.js docs", kind: "Website", ask: "add a floating table of contents on the right side that stays in view as I scroll and highlights the section I'm reading", by: "Claude Code (opus)", src: "shots/222-web-nodejs-floating-toc.webp", width: 1200, height: 750, alt: "The Node.js file system docs with a floating table of contents on the right, highlighting the section being read." },
  { app: "PyPI", kind: "Website", ask: "add a copy button to the top right corner of every code example", by: "Claude Code (sonnet), 12.7 seconds", src: "shots/182-web-pypi-copy-buttons.webp", width: 1280, height: 800, alt: "The requests page on PyPI with a new Copy button on the code example. The bar offers Save." },
  { app: "Docker Hub", kind: "Website", ask: "Explain this page", by: "Claude Code (sonnet), 6.4 seconds", src: "shots/313-real-explain.webp", width: 1280, height: 800, alt: "The nginx page on Docker Hub with numbered markers on the tabs, the tag list and the copy button, and the bar explaining each one." },
  { app: "RubyGems", kind: "Website", ask: "give this page a dark reading mode: one consistent deep charcoal background across the whole page, soft off-white text, and links, buttons and numbers that stay easy to read", by: "Claude Code (opus)", src: "shots/223-web-rubygems-dark-mode.webp", width: 1200, height: 750, alt: "The rails page on RubyGems in a dark reading mode: charcoal background, soft white text and blue links." },
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
