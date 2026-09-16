import { describe, expect, it } from "vitest";
import { placeFloatingPanel, visibleFloatingBounds } from "../../../../packages/ui/src/components/ui/floatingPlacement";

describe("floating editor and popover placement", () => {
  const bounds = { left: 8, right: 312, top: 8, bottom: 732 };
  it("clamps a right-edge selection, and flips down when there is no room above", () => {
    expect(placeFloatingPanel({ left: 300, top: 20, bottom: 40 }, { width: 294, height: 48 }, bounds, true, 8)).toEqual({ left: 18, top: 48 });
  });
  it("flips above the bottom edge, including a larger wrapped toolbar", () => {
    expect(placeFloatingPanel({ left: -20, top: 680, bottom: 710 }, { width: 300, height: 96 }, bounds, false, 8)).toEqual({ left: 8, top: 576 });
  });
  it("uses the shifted and reduced visual viewport with safe-area insets", () => {
    const shifted = visibleFloatingBounds({ innerWidth: 375, innerHeight: 812,
      visualViewport: { offsetLeft: 30, offsetTop: 50, width: 250, height: 300 } } as Window,
    { left: 16, top: 20 });
    expect(shifted).toEqual({ left: 46, top: 70, right: 272, bottom: 342 });
    expect(placeFloatingPanel({ left: 350, top: 320, bottom: 340 }, { width: 200, height: 80 }, shifted)).toEqual({ left: 72, top: 236 });
  });
});
