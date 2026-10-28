/* MPL-2.0. Stage sizing and camera integration for the Zephium port.
 * See README.md. Morse steps use the corresponding upstream camera shots. */
import { STAGE, SHOTS, cover, frame } from './camera.js';
export function mountStage(root) {
  const stage = root.querySelector('.ob-stage');
  const rig = root.querySelector('.ob-rig');
  const shots = { model: SHOTS.ai, open: SHOTS.ai, how: SHOTS.launcher, apps: SHOTS.essentials };
  function place() {
    const { width, height } = root.getBoundingClientRect();
    if (!width || !height) return;
    const fit = Math.min(width / STAGE.width, height / STAGE.height);
    stage.style.transform = `translate(-50%, -50%) scale(${fit})`;
    const shot = shots[root.dataset.step] || cover({width: width / fit, height: height / fit});
    rig.style.transform = frame(shot);
    rig.style.setProperty('--reach', `${shot.fade ?? 1200}px`);
    rig.dataset.masked = String(!!shot.fade || root.dataset.step === 'welcome');
    rig.dataset.placed = 'true';
    stage.style.setProperty('--stage-fit', fit);
  }
  const size = new ResizeObserver(place); size.observe(root);
  const state = new MutationObserver(place); state.observe(root,{attributes:true,attributeFilter:['data-step','hidden']});
  place();
  return () => { size.disconnect(); state.disconnect(); };
}
