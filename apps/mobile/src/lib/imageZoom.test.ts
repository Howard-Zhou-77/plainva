import { describe, expect, it } from "vitest";
import { boundImageTransform, imageFit, zoomImageAt } from "./imageZoom";
const box = { width: 400, height: 600, imageWidth: 1600, imageHeight: 1200 };
describe("viewer zoom geometry", () => {
  it("keeps a pinch anchor in place and follows its midpoint", () => {
    const next = zoomImageAt(imageFit, 3, { x: 50, y: 20 }, { x: 70, y: 40 }, box);
    expect(next).toEqual({ scale: 3, x: -80, y: -20 });
    expect((50 - imageFit.x) * next.scale + next.x).toBe(70);
  });
  it("bounds pans, zoom and invalid values, and returns to a centered fit", () => {
    expect(boundImageTransform({ scale: 100, x: Infinity, y: -99999 }, box)).toEqual({ scale: 6, x: 0, y: -600 });
    expect(boundImageTransform({ scale: 1, x: 200, y: -400 }, box)).toEqual(imageFit);
    expect(boundImageTransform({ scale: NaN, x: NaN, y: NaN }, box)).toEqual(imageFit);
  });
});
