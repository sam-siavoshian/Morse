// Every link target and the demo video, in one place.
//
// Each page's buttons carry data-link="chrome" or data-link="desktop", and
// common.js points them here when the page loads. The href written in the
// HTML is the same placeholder, so the buttons work before the script runs.
//
// Paths are relative to site/ (the folder these pages are in).
// tests/site.test.js checks that every one of them resolves.

export const LINKS = {
  // "Get it for Chrome". The install steps on the landing page, until the
  // Chrome Web Store listing is live: then put its address here.
  chrome: "./#install-chrome",
  // "Get the desktop app". The install steps, until there is a download.
  desktop: "./#install-desktop",
  github: "https://github.com/sam-siavoshian/RRAA",
  docs: "https://github.com/sam-siavoshian/RRAA/tree/HEAD/docs",
};

// The film under the headline. To swap in a new video, put the file in
// docs/launch/ (or site/) and change mp4 and poster; width and height set the
// frame's shape before it loads. caption is the line under it, and label is
// what a screen reader says.
export const DEMO_VIDEO = {
  mp4: "../docs/launch/morse-demo-v2.mp4",
  poster: "../docs/launch/poster-video-v2.jpg",
  width: 1280,
  height: 800,
  label: "The Morse demo",
  caption: "The demo, 92 seconds, no sound. Recorded from real runs: Claude Code wrote the sleep timer, the button, the fix and the round covers. Waits for the model are sped up, and the video says so.",
};
