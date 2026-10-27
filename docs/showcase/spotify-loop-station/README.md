# Spotify Loop Station

A working Morse mod, tested in Spotify for macOS. It adds a player button and eight local pads. Each pad stores a song section and repeats that section through Spotify's real playback controls. No audio is copied or exported.

The feature was requested through Morse. Generation stalled, so Codex completed the mod directly. The landing-page clip records the working result in the installed Spotify app; it does not claim successful generation from one prompt or a generation time.

Verified in the app:

- A pad covering 0:00–0:03 moved Spotify's native progress bar to 0:00 and completed four repeats.
- A second pad covering 0:30–0:35 moved the native progress slider to 30,000 ms and repeated that section.
- Stop loop released playback: Spotify advanced from 0:33 to 0:51 without returning to the loop start.
- Keyboard shortcuts 1 and 2 selected their corresponding pads and sought to the saved start points.
- Saved pads are scoped to the current song and kept locally by Morse.

`loop-station.morse.json` is the installable mod. `mod.js` and `mod.css` are its readable sources. The seek helper uses Spotify's real range control and React callback, with a pointer-event fallback for alternate versions. Future Spotify UI updates may require a selector update. Section loops use the normal player seek function and are not sample-accurate audio editing.
