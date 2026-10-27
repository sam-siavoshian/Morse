// DOM rectangles are CSS pixels; CDP's screenshot viewport is in device-
// independent pixels. Browser zoom matters independently of display density.
// Without this conversion a zoomed-out app can send an empty crop to the model.
export function screenshotClip(area, metrics = {}) {
  const zoom = metrics.cssVisualViewport?.zoom || metrics.visualViewport?.zoom || 1;
  const density = area.dpr || 1;
  return {
    x: (area.x + (area.scrollX || 0)) * zoom,
    y: (area.y + (area.scrollY || 0)) * zoom,
    width: area.width * zoom,
    height: area.height * zoom,
    // shotArea's scale caps the model image in CSS pixels, not Retina pixels.
    scale: (area.scale || 1) / density,
  };
}
