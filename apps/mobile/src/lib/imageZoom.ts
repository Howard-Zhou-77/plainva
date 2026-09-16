export interface ImageTransform { scale: number; x: number; y: number }
export interface ImageBounds { width: number; height: number; imageWidth: number; imageHeight: number }
export const IMAGE_ZOOM_MAX = 6;
export const imageFit: ImageTransform = { scale: 1, x: 0, y: 0 };
export function boundImageTransform(value: ImageTransform, box: ImageBounds): ImageTransform {
  const scale = Math.min(IMAGE_ZOOM_MAX, Math.max(1, Number.isFinite(value.scale) ? value.scale : 1));
  const fit = Math.min(box.width / Math.max(1, box.imageWidth), box.height / Math.max(1, box.imageHeight), 1);
  const maxX = Math.max(0, (box.imageWidth * fit * scale - box.width) / 2);
  const maxY = Math.max(0, (box.imageHeight * fit * scale - box.height) / 2);
  return { scale, x: Math.min(maxX, Math.max(-maxX, Number.isFinite(value.x) ? value.x : 0)) || 0, y: Math.min(maxY, Math.max(-maxY, Number.isFinite(value.y) ? value.y : 0)) || 0 };
}
export function zoomImageAt(current: ImageTransform, scale: number, from: { x: number; y: number }, to: { x: number; y: number }, box: ImageBounds): ImageTransform {
  const next = Math.min(IMAGE_ZOOM_MAX, Math.max(1, scale));
  return boundImageTransform({ scale: next, x: to.x - (from.x - current.x) * next / current.scale, y: to.y - (from.y - current.y) * next / current.scale }, box);
}
