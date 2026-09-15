import { describe, expect, it } from "vitest";
import { comparisonPath, comparisonSubject } from "./comparisonWindow";
import { adoptTabInLayout, type Layout } from "../hooks/usePaneLayout";

describe("selected comparison and transferred tab identity", () => {
  it("round-trips an exact snapshot with reserved characters and Unicode", () => {
    const path = "Folder/Plan #1 & 😀.md", version = ".plainva/backups/Plan #1/2026-09-14.md";
    expect(comparisonSubject(comparisonPath(path, version, true))).toEqual({ kind: "version", path, selectedBackupPath: version, orphan: true });
    expect(comparisonSubject("plainva://compare?path=note.md")).toBeNull();
  });
  it("preserves history, selection of a pinned tab and the pinned partition", () => {
    const layout: Layout = { panes: [{ activeIndex: 0, tabs: [{ history: ["Other.md"], historyIndex: 0 }] }], direction: "vertical", activePaneIndex: 0 };
    const tab = { history: ["Before.md", "Note.md", "After.md"], historyIndex: 1, pinned: true };
    const next = adoptTabInLayout(layout, tab);
    expect(next.panes[0].tabs).toEqual([tab, ...layout.panes[0].tabs]);
    expect(next.panes[0].activeIndex).toBe(0);
    expect(adoptTabInLayout(next, tab).panes[0].tabs).toHaveLength(2);
    expect(layout.panes[0].tabs).toHaveLength(1);
  });
});
