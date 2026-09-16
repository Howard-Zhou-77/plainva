import { beforeEach, describe, expect, it } from "vitest";
import { chromeScrollPublisher, getChromeScroll, resetChromeScroll } from "./chromeScroll";

describe("reader chrome movement", () => {
  beforeEach(resetChromeScroll);
  it("accumulates small downward moves, returns on the first upward move, and clamps overscroll", () => {
    const publish = chromeScrollPublisher("reader");
    for (let top = 0; top <= 80; top += 2) publish(top);
    expect(getChromeScroll()).toEqual({ scrolled: true, away: true, source: "reader" });
    publish(79); expect(getChromeScroll().away).toBe(false);
    publish(-30); expect(getChromeScroll()).toEqual({ scrolled: false, away: false, source: "reader" });
  });
  it("restores a saved position without hiding navigation and identifies the actual scroller", () => {
    const reader = chromeScrollPublisher("reader"); reader(900, true); reader(900);
    expect(getChromeScroll().away).toBe(false);
    reader(928); expect(getChromeScroll().away).toBe(true);
    chromeScrollPublisher("navigator")(120);
    expect(getChromeScroll().source).toBe("navigator");
  });
});
