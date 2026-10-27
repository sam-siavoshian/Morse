/* MPL-2.0; ported from Zephium lib/camera.ts. See LICENSE and README.md. */
const STAGE = { width: 1240, height: 780 };
const WINDOW = { width: 880, height: 560 };
const PAGE = { x: 248, y: 8, width: 624, height: 544 };
const NEWTAB = {
  notch: { width: 380, height: 38 },
  horizon: 326,
  name: { x: 199.5, y: 223, w: 225, h: 32.31 },
  when: 265
};
const CENTRE = [WINDOW.width / 2, WINDOW.height / 2];
const SHOTS = {
  // Whole, to the left, so the folder an import brings lands in plain view.
  import: { scale: 0.7, focus: CENTRE, at: [400, 468] },
  // Crossing to the right and closing in on the dock.
  essentials: { scale: 0.78, focus: [230, 410], at: [846, 560] },
  // Lowered out of the frame while the launcher has the stage.
  launcher: { scale: 0.7, focus: CENTRE, at: [620, 1180] },
  work: { scale: 0.82, focus: CENTRE, at: [620, 452] },
  // Sunk back under the choices, only its top showing: what they power.
  ai: { scale: 0.78, focus: [440, 0], at: [620, 500], fade: 240 },
  ready: { scale: 0.7, focus: CENTRE, at: [620, 462] }
};
function cover(view) {
  const scale = Math.max(view.width / PAGE.width, view.height / PAGE.height, 1) * 1.04;
  return {
    scale,
    focus: [PAGE.x + PAGE.width / 2, PAGE.y + PAGE.height / 2],
    at: [STAGE.width / 2, STAGE.height / 2]
  };
}
function land(shot, [x, y]) {
  return [
    shot.at[0] + shot.scale * (x - shot.focus[0]),
    shot.at[1] + shot.scale * (y - shot.focus[1])
  ];
}
function frame(shot) {
  const [cx, cy] = CENTRE;
  const x = shot.at[0] - cx - shot.scale * (shot.focus[0] - cx);
  const y = shot.at[1] - cy - shot.scale * (shot.focus[1] - cy);
  return `translate(${round(x)}px, ${round(y)}px) scale(${round(shot.scale, 4)})`;
}
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
export {
  NEWTAB,
  PAGE,
  SHOTS,
  STAGE,
  WINDOW,
  cover,
  frame,
  land
};
