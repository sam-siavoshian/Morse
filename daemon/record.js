// Records the change as it happens (CDP screencast) and turns it into a GIF and
// an MP4 with ffmpeg: the clip people post.

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { HOME } from "./store.js";

const MAX_FRAMES = 1800;

export class Recorder {
  constructor(session) {
    this.s = session;
    this.frames = [];
    this.onFrame = p => {
      if (this.stopped) return;
      // Keep the most recent frames: the change happens at the end, not the start.
      this.frames.push({ data: p.data, t: p.metadata.timestamp });
      if (this.frames.length > MAX_FRAMES) this.frames.shift();
      this.s.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
    };
  }
  async start() {
    this.s.on("Page.screencastFrame", this.onFrame);
    await this.s.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  }
  // Drop frames from a window (Morse hides its UI for before/after shots).
  drop(from, to) { this.frames = this.frames.filter(f => f.t < from || f.t > to); }
  stop() {
    this.stopped = true;
    this.s.off("Page.screencastFrame", this.onFrame);
    this.s.send("Page.stopScreencast").catch(() => {});
  }
  async finish(name) {
    this.stop();
    if (this.frames.length < 2) return null;
    const dir = path.join(HOME, "clips", String(name).replace(/[^a-z0-9_-]/gi, ""));
    await fs.mkdir(dir, { recursive: true });
    // Screencast only sends frames on change; rebuild real timing with a concat list.
    const list = [];
    for (let i = 0; i < this.frames.length; i++) {
      const f = `f${String(i).padStart(4, "0")}.jpg`;
      await fs.writeFile(path.join(dir, f), Buffer.from(this.frames[i].data, "base64"));
      const next = this.frames[i + 1]?.t ?? this.frames[i].t + 1.2;
      list.push(`file '${f}'`, `duration ${Math.max(0.016, next - this.frames[i].t).toFixed(3)}`);
    }
    list.push(`file 'f${String(this.frames.length - 1).padStart(4, "0")}.jpg'`);
    await fs.writeFile(path.join(dir, "frames.txt"), list.join("\n"));
    const gif = path.join(dir, "morse.gif"), mp4 = path.join(dir, "morse.mp4");
    const base = ["-y", "-f", "concat", "-safe", "0", "-i", "frames.txt"];
    try {
      await ffmpeg(dir, [...base, "-vf", "fps=25,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer", gif]);
      await ffmpeg(dir, [...base, "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
      for (const f of await fs.readdir(dir)) if (/^f\d+\.jpg$/.test(f)) await fs.rm(path.join(dir, f));
      this.frames = [];
      return { kind: "gif + mp4", path: gif, mp4 };
    } catch {
      return { kind: "frames", path: dir };
    }
  }
}

function ffmpeg(cwd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-loglevel", "error", ...args], { cwd, stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}
