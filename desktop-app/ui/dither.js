// The edge of a sky coming apart into the page, as on the website
// (site/motion.js, mountDither): a grid of squares in the page's colour, none
// at the sky's side and whole at the page's, each a little bigger or smaller
// than its row by a fixed noise so the line is ragged. data-dither="down"
// thickens downward, "up" upward. It is a still picture, so it is drawn with
// reduced motion too. A canvas that is hidden draws once it gets a size.
export function mountDither(canvas) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  const up = canvas.dataset.dither === "up";
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0b";
  const cell = 5;
  const noise = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const draw = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color;
    for (let row = 0, y = 0; y < h; row++, y += cell) {
      const t = (y + cell / 2) / h;
      const depth = up ? 1 - t : t;
      for (let col = 0, x = 0; x < w; col++, x += cell) {
        const s = depth > 0.92 ? 1 : Math.min(1, Math.max(0, depth * 1.15 - 0.1 + (noise(col, row) - 0.5) * 0.22));
        if (s < 0.08) continue;
        const size = s > 0.94 ? cell : cell * s;
        ctx.fillRect(x + (cell - size) / 2, y + (cell - size) / 2, size, size);
      }
    }
  };
  new ResizeObserver(draw).observe(canvas);
  document.documentElement.setAttribute("data-dithered", "");
}
