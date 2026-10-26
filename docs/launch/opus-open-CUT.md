# morse-opus-open: launch cut

**Duration:** 33.0 s (1920x1080, 30 fps).

It opens on the finished change: The Daily Byte with a new headline, no ads, dark mode and a speedrun timer reading 0:24.0. It rewinds to the page as it was, then plays the run that got there. After that it shows the same thing in a desktop app (Obsidian), the Mods list, the shortcut recorder and the update window. It ends on the install line.

## Files

| File | What | Size |
| --- | --- | --- |
| `morse-opus-open-16x9.mp4` | Master. H.264 High + AAC 48 kHz stereo, 256 kb/s | 13.8 MB |
| `morse-opus-open-web.mp4` | Muted site loop, 1280x720 H.264 | 1.9 MB |
| `morse-opus-open-web.webm` | Muted site loop, 1280x720 VP9 | 1.7 MB |
| `morse-opus-open-poster.webp` | Hook frame at 1.0 s, 1920x1080 | 93 KB |

## Shot list

The bed runs at 120 BPM, so a beat is 0.5 s. Every cut is on a beat, and the reveals land on a kick.

| Time | Shot | What happens |
| --- | --- | --- |
| 0.0–1.6 | Hook | The Daily Byte, finished: "A quieter front page", no ads, dark. Timer 0:24.0 with all three splits. Slow push-in. |
| 1.6–2.0 | Rewind | The run plays backwards and the timer counts down to 0:00.0. |
| 2.0–3.0 | Before | The page as it was: the original headline, four ad slots and the newsletter pop-up. |
| 3.0–14.0 | Run | Speedrun of one real take. The timer starts at 3.0. |
| 3.5 | | Ctrl Shift Space opens the bar. |
| 4.5–4.9 | | Points at the headline, then Edit text. |
| 5.2–6.0 | | Types "A quieter front page". Split: Headline 0:09.6. |
| 8.0–9.0 | | Page tools, then Hide ads and pop-ups. The ads go on the kick at 9.0. Split: Ads gone 0:17.4. |
| 11.0–12.0 | | Page tools, then Dark mode. The page turns dark at 12.0. Split: Dark mode 0:24.0. |
| 12.0–14.0 | | Holds on the result. The kick drops out for 1 s under a riser. |
| 14.0–15.5 | Apps | The Morse desktop app, one apps list in hairline rows. Clicks Open with Morse on Obsidian and cuts in on the kick to "Opening Obsidian with Morse…". |
| 15.5–16.0 | Connected | "Connected · 1 window", with Open the bar and Disconnect. |
| 16.0–19.0 | Obsidian | Ctrl Shift Space opens the bar in Obsidian, then Page tools, then Light mode at 18.0. The toast reads "Light mode on for Obsidian". |
| 19.0–21.0 | Mods | The app name on its own line with the count under it: Obsidian "1 mod · 1 on", byte "3 mods · 3 on", and the four mods from this film. |
| 21.0–23.0 | Shortcut | Settings, Open Morse. Clicks the recorder and presses Ctrl, Alt, M. "Saved", "Use the default". |
| 23.0–26.0 | Update | The update window with the radar mark and a 1px edge. "Downloading the new version…" from 0 to 99%, then "The update is ready" with Later and Restart now at 25.0. |
| 26.0–33.0 | End | Radar mark. "Change any app in your own words." The install line is fully on screen from about 26.95 and held to the last frame, about 6 s. "macOS and Linux, in Terminal". |

```
curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install-app.sh | sh
```

### Speed

- **Run:** 24.0 s of the take plays in 9 s. Typing runs at about 2x and the gaps between clicks at 2.3x to 3.4x. The 2.9 s from pointing to Edit text plays in 0.4 s, about 7x. The held results run at 1x to 1.4x.
- **Obsidian:** 5.6 s plays in 3 s. The idle stretch before Page tools runs at 4x, the move to Light mode at 2.8x, and the rest at 1x to 1.3x.
- **Desktop shots:** Apps and Mods run at about 1x, the shortcut at 1.2x to 2.8x, and the update download at 1.5x.

## Footage

All the footage was recorded for this cut from this branch's build (Morse 0.3.1). Each take is a 1920x1080, 30 fps screen capture of a private X display. No frame comes from an older film.

| Take | Source |
| --- | --- |
| `byte-result`, `byte-before`, `byte-flow` | The Daily Byte demo page (`demo/serve.js`) in Chrome, opened by Morse (`node daemon/cli.js launch google-chrome`). |
| `desk-apps`, `desk-mods`, `desk-shortcut`, `desk-update` | The Morse desktop app (`desktop-app/`, Electron, dark theme). |
| `obs-change` | Obsidian 1.14.5 (the official AppImage, unpacked), opened through Open with Morse with a small seeded vault. |

Not used:

- A relaunch take showing the three mods restored, cut for length.
- Every older v3 and v4 take, because their bar reads "Connect a model". An OCR pass over one frame per second of the master finds no "Connect a model".

## Sound

- **The bed:** original, made for this cut. It is synthesized in numpy, in E minor at 120 BPM:
  - kick on every beat, snare on 2 and 4, and hats from 2.0 to 25.5, with a 1 s break at 13.0;
  - bass on the off-beats;
  - a pad and an arpeggio following Em, C, G and D;
  - risers into each reveal and a low impact on it;
  - UI ticks on the clicks and key presses, as they appear on screen;
  - a rising tone under the update download, and a soft chime when it's ready.
- **End card:** the drums stop at 26.0. Morse's own intro sound sits under the install line: `desktop-app/ui/sounds/intro.m4a`, from [Zephium](https://github.com/zephium-browser/zephium), MPL 2.0. It's trimmed to its first 3 s with a fade-out and lowered in level.
- **Speech:** none.
- **Loudness:** measured with ffmpeg `ebur128=peak=true` on the master's AAC track. -14.6 LUFS integrated, true peak -1.4 dBTP, loudness range 5.6 LU.

## Honesty notes

- **"Claude Code · opus" in the bar footer:** the recording's Morse settings chose Claude Code, so the bar names it. No model was called: Edit text and Page tools are built in, and Claude Code isn't installed on the recording machine.
- **The update window:** it's the real dialog in the real app, but no download happened. The recording script pushed the status (0 to 99%, then ready) into it.
- **The timer:** it counts real recorded time, from the moment the bar is opened (0:00.0) to dark mode (0:24.0), including the script's pauses between steps. The split times come from the take. It speeds up only because the footage does.
- **What was added on top:** the timer panel and the end card. The cursor moves were scripted. No product UI was drawn, retouched or invented.

## Checks

- **ffprobe on the master:** 33.000 s and 13,762,431 bytes. One H.264 1920x1080 30 fps stream and one AAC 48 kHz stereo stream.
- **Scrubbed frames:**
  - 0.5 s: the finished page with the timer. There's no logo, title card or "introducing" in the first 2 s.
  - 2.0 s: the before page with the timer at 0:00.0.
  - 16.5 s, the middle: Obsidian with the Morse bar open.
  - 32.5 s, the last second: the install line.

## Tweet

Morse changes any app in your own words: a new headline, no ads and dark mode on a news site, then a light mode for Obsidian.
