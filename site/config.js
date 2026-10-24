// Every link target, the film and the real pictures, in one place.
//
// Each page's buttons carry data-link="chrome" or data-link="desktop", and
// common.js points them here when the page loads. The href written in the
// HTML is the same placeholder, so the buttons work before the script runs.
//
// Paths are relative to site/ (the folder these pages are in).
// tests/site.test.js checks that every one of them resolves.

export const LINKS = {
  // "Add to Chrome". Until the Chrome Web Store listing is live, it opens the
  // steps for installing by hand. Then put the listing's address here.
  chrome: "./#chrome-steps",
  // "Download Morse": Morse Desktop. Until there is a download, it opens the
  // steps for the morse command. Then put the download page's address here.
  desktop: "./#desktop-steps",
  github: "https://github.com/sam-siavoshian/RRAA",
  docs: "https://github.com/sam-siavoshian/RRAA/tree/HEAD/docs",
};

// The film under the headline. To swap in a new video, put the file in
// docs/launch/ (or site/) and change mp4 and poster; width and height set the
// frame's shape before it loads. caption is the line under it, label is what a
// screen reader says, and strip is the short line above it.
export const DEMO_VIDEO = {
  mp4: "../docs/launch/morse-v3-16x9.mp4",
  poster: "shots/202-film-poster.webp",
  width: 1920,
  height: 1080,
  label: "Morse changing VS Code, Obsidian, Logseq, nodejs.org and Docker Hub, 34 seconds",
  strip: "Real apps on Linux · Claude Code (Opus) · real runs",
  caption: "34 seconds. Microsoft’s VS Code, Obsidian and Logseq as downloaded, and the live nodejs.org and Docker Hub. Claude Code (Opus) wrote each change (Your style needs no model); waits for the model are sped up, and the video says so. Music: “Voxel Revolution” by Kevin MacLeod, CC BY 4.0.",
};

// "See it change": the big before and after pairs, in order. Each picture is a
// real screenshot of a real app or website; app is the name exactly as it
// shows on screen. before and after must be the same size (width × height),
// since one slides over the other. To swap a pair, change it here only.
export const SHOWCASE = [
  {
    app: "VSCodium",
    kind: "Desktop app, on Linux",
    note: "VS Code without Microsoft’s branding.",
    ask: "make it look like a retro green terminal: green glowing text on black",
    by: "Claude Code (haiku), 11.6 seconds",
    before: "shots/200-vscodium-terminal-before.webp",
    after: "shots/201-vscodium-terminal-after.webp",
    width: 1200, height: 750,
    alt: {
      before: "VSCodium with its usual dark theme. The Morse bar at the bottom holds the request.",
      after: "The same VSCodium window, all green text on black like an old terminal. The bar offers Save and Undo.",
    },
  },
  {
    app: "Obsidian",
    kind: "Desktop app, on Linux",
    note: "Pointed at the ribbon on the left, then opened again after saving.",
    ask: "hide this ribbon",
    by: "Claude Code (haiku)",
    before: "shots/149-obsidian-bar.webp",
    after: "shots/150-obsidian-ribbon-gone.webp",
    width: 1024, height: 800,
    alt: {
      before: "Obsidian with the ribbon of icons on the left outlined, and the Morse bar asking what to change.",
      after: "Obsidian opened again: the ribbon is gone and the file list starts at the left edge.",
    },
  },
  {
    app: "PyPI",
    kind: "Website, in Chrome",
    note: "pypi.org/project/requests, checked on the live site.",
    ask: "dark mode for the whole page, including the sidebar on the right, with text that’s easy to read",
    by: "Claude Code (haiku)",
    before: "mods/shots/pypi-dark-mode-before.jpg",
    after: "mods/shots/pypi-dark-mode-after.jpg",
    width: 1280, height: 800,
    alt: {
      before: "The PyPI page for requests, with its blue header and white page.",
      after: "The same PyPI page in dark mode, with light text on dark grey.",
    },
  },
  {
    app: "Node.js docs",
    kind: "Website, in Chrome",
    note: "nodejs.org/api/path.html, checked on the live site.",
    ask: "show the table of contents on the right side and keep it there while I scroll",
    by: "Claude Code (haiku)",
    before: "mods/shots/nodejs-side-contents-before.jpg",
    after: "mods/shots/nodejs-side-contents-after.jpg",
    width: 1280, height: 800,
    alt: {
      before: "The Node.js path documentation, with its contents only at the top of the page.",
      after: "The same page with the contents in a column on the right, beside the text.",
    },
  },
];

// The strip of real apps and websites, each a real screenshot with the Morse
// bar open. app is the name exactly as it shows on screen; ask is what was
// asked (empty for a change made by hand with the Edit tools).
export const REAL_APPS = [
  { app: "Joplin", kind: "Desktop app", ask: "hide this button, I don’t use sync", src: "shots/152-joplin-sync-hidden.webp", width: 1152, height: 720, alt: "Joplin after “hide this button, I don’t use sync”: the Synchronize button is gone and the bar offers Save." },
  { app: "VSCodium", kind: "Desktop app", ask: "make the status bar bigger", src: "shots/148-vscodium-status-bar-back.webp", width: 1208, height: 804, alt: "VSCodium opened again after “make the status bar bigger”: the taller status bar is still there." },
  { app: "GitLab", kind: "Website", ask: "add a back to top button in the bottom right corner", src: "shots/153-web-gitlab-back-to-top.webp", width: 1280, height: 800, alt: "A GitLab project page with a new floating back to top button, and the bar offering Save." },
  { app: "Docker Hub", kind: "Website", ask: "make these code blocks bigger with a dark background", src: "shots/155-web-docker-hub-code.webp", width: 1280, height: 800, alt: "The nginx page on Docker Hub with larger, dark code blocks, and the bar offering Save." },
  { app: "Go packages", kind: "Website", ask: "put the code examples on a dark background with bigger text, and hide the survey banner", src: "shots/180-web-go-packages.webp", width: 1280, height: 800, alt: "The net/http page on pkg.go.dev with code examples on a dark background while the change is written." },
  { app: "RubyGems", kind: "Website", ask: "", by: "The Edit tools: change it by hand, no model", src: "shots/181-web-rubygems-edit.webp", width: 1280, height: 800, alt: "The rails page on RubyGems with the Edit tools open on the heading: hide, move, resize, text and color." },
];