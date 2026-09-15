import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDatabaseAdapter } from "@plainva/core";
const state = vi.hoisted(() => ({ owner: false, request: vi.fn(async () => {}) }));
vi.mock("./windowContext", () => ({ isOwnerWindow: () => state.owner }));
vi.mock("./windowBus", () => ({ getWindowBus: async () => ({ request: state.request }) }));
import { parkEditorSuggestion, clearEditorSuggestion } from "./editorSuggestionPark";

describe("suggestion drafts in separate windows", () => {
  beforeEach(() => { state.owner = false; state.request.mockClear(); });
  const record = { path: "Note.md", base: "original", copy: "proposal", note: "Review", savedAt: "2026-09-14T12:00:00.000Z" };
  it("delegates mutations to the owner without using the read-only client connection", async () => {
    const execute = vi.fn(async () => { throw Error("Read-only"); });
    const db = { execute } as unknown as IDatabaseAdapter;
    await parkEditorSuggestion(db, record, "/vault"); await clearEditorSuggestion(db, record.path, "/vault");
    expect(execute).not.toHaveBeenCalled();
    expect(state.request.mock.calls).toEqual([["suggestion-park-write", record, { vaultPath: "/vault" }], ["suggestion-park-clear", { path: record.path }, { vaultPath: "/vault" }]]);
  });
  it("writes the owner's draft and never the note file", async () => {
    state.owner = true;
    const execute = vi.fn(async () => {}), db = { execute } as unknown as IDatabaseAdapter;
    await parkEditorSuggestion(db, record, "/vault");
    expect(execute.mock.calls[0]).toEqual([expect.stringContaining("INSERT OR REPLACE INTO meta"), ["suggestion-park:Note.md", expect.stringContaining('"copy":"proposal"')]]);
    expect(state.request).not.toHaveBeenCalled();
  });
});
